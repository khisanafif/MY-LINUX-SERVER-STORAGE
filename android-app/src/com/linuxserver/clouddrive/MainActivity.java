package com.linuxserver.clouddrive;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.webkit.DownloadListener;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Android WebView client untuk Linux Cloud Drive dengan:
 * - Koneksi otomatis multi-endpoint (Wi-Fi LAN offline + Cloudflared online)
 * - Auto-sync endpoint terbaru dari /api/info setiap kali terhubung
 * - Dukungan opsional Discovery URL jika link Cloudflared berganti saat di luar
 * - Multi-file upload & DownloadManager
 */
public class MainActivity extends Activity {
    private static final String PREFS_NAME = "cloud_drive_prefs";
    private static final String KEY_LAN_URLS = "lan_urls";
    private static final String KEY_PUBLIC_URL = "public_url";
    private static final String KEY_DISCOVERY_URL = "discovery_url";
    private static final String KEY_LAST_URL = "last_url";
    private static final String DEFAULT_LAN_URLS = "http://192.168.1.13:8080,http://192.168.1.15:8080";
    private static final int FILE_CHOOSER_REQ = 1001;

    private WebView webView;
    private ScrollView setupScroll;
    private EditText lanInput;
    private EditText publicInput;
    private EditText discoveryInput;
    private TextView statusText;
    private ValueCallback<Uri[]> filePathCallback;
    private String activeBaseUrl = "";
    private boolean autoConnecting = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#F8FAFD"));

        webView = new WebView(this);
        setupWebView(webView);
        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        ));

        setupScroll = buildSetupOverlay();
        root.addView(setupScroll, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        ));

        setContentView(root);
        autoConnectBestEndpoint(false);
    }

    private SharedPreferences getPrefs() {
        return getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
    }

    private ScrollView buildSetupOverlay() {
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(Color.parseColor("#F8FAFD"));

        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER_HORIZONTAL);
        panel.setPadding(56, 80, 56, 64);

        TextView title = new TextView(this);
        title.setText("Linux Cloud Drive");
        title.setTextSize(24);
        title.setTextColor(Color.parseColor("#1F1F1F"));
        title.setGravity(Gravity.CENTER);
        panel.addView(title);

        statusText = new TextView(this);
        statusText.setText("Mencari server Wi-Fi / Cloudflared otomatis...");
        statusText.setTextSize(14);
        statusText.setTextColor(Color.parseColor("#5F6368"));
        statusText.setGravity(Gravity.CENTER);
        statusText.setPadding(0, 14, 0, 28);
        panel.addView(statusText);

        panel.addView(makeLabel("Alamat Wi-Fi / LAN (Offline, pisah koma):"));
        lanInput = makeInput(getPrefs().getString(KEY_LAN_URLS, DEFAULT_LAN_URLS), DEFAULT_LAN_URLS);
        panel.addView(lanInput);

        panel.addView(makeLabel("Link Publik Cloudflared (Online, otomatis ter-update):"));
        publicInput = makeInput(getPrefs().getString(KEY_PUBLIC_URL, ""), "https://xxxx-xxxx.trycloudflare.com");
        panel.addView(publicInput);

        panel.addView(makeLabel("Link Discovery / Domain Tetap (Opsional):"));
        discoveryInput = makeInput(getPrefs().getString(KEY_DISCOVERY_URL, ""), "Opsional: URL JSON/teks berisi link terbaru");
        panel.addView(discoveryInput);

        Button autoBtn = makeButton("Cari & Hubungkan Otomatis", "#0B57D0", Color.WHITE);
        autoBtn.setOnClickListener(v -> {
            saveManualInputs();
            autoConnectBestEndpoint(true);
        });
        panel.addView(autoBtn);

        Button openPublicBtn = makeButton("Buka Link Cloudflared Langsung", "#E8F0FE", Color.parseColor("#0B57D0"));
        openPublicBtn.setOnClickListener(v -> {
            saveManualInputs();
            String pub = normalizeUrl(publicInput.getText().toString());
            if (pub.isEmpty()) {
                Toast.makeText(this, "Masukkan link Cloudflared terlebih dahulu", Toast.LENGTH_SHORT).show();
                return;
            }
            connectToServer(pub);
        });
        panel.addView(openPublicBtn);

        scroll.addView(panel);
        return scroll;
    }

    private TextView makeLabel(String txt) {
        TextView tv = new TextView(this);
        tv.setText(txt);
        tv.setTextSize(12);
        tv.setTextColor(Color.parseColor("#444746"));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        );
        lp.topMargin = 18;
        lp.bottomMargin = 6;
        tv.setLayoutParams(lp);
        return tv;
    }

    private EditText makeInput(String value, String hint) {
        EditText et = new EditText(this);
        et.setText(value);
        et.setHint(hint);
        et.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        et.setSingleLine(true);
        et.setBackgroundColor(Color.WHITE);
        et.setTextColor(Color.parseColor("#1F1F1F"));
        et.setPadding(28, 24, 28, 24);
        return et;
    }

    private Button makeButton(String text, String bgHex, int fgColor) {
        Button b = new Button(this);
        b.setText(text);
        b.setBackgroundColor(Color.parseColor(bgHex));
        b.setTextColor(fgColor);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        );
        lp.topMargin = 22;
        b.setLayoutParams(lp);
        return b;
    }

    private void saveManualInputs() {
        String lan = lanInput.getText().toString().trim();
        String pub = normalizeUrl(publicInput.getText().toString());
        String disc = normalizeUrl(discoveryInput.getText().toString());
        getPrefs().edit()
                .putString(KEY_LAN_URLS, lan.isEmpty() ? DEFAULT_LAN_URLS : lan)
                .putString(KEY_PUBLIC_URL, pub)
                .putString(KEY_DISCOVERY_URL, disc)
                .apply();
    }

    private String normalizeUrl(String raw) {
        String s = raw == null ? "" : raw.trim();
        if (s.isEmpty()) return "";
        if (!s.startsWith("http://") && !s.startsWith("https://")) {
            s = "http://" + s;
        }
        while (s.endsWith("/")) {
            s = s.substring(0, s.length() - 1);
        }
        return s;
    }

    private void showSetupPanel(String message) {
        statusText.setText(message);
        lanInput.setText(getPrefs().getString(KEY_LAN_URLS, DEFAULT_LAN_URLS));
        publicInput.setText(getPrefs().getString(KEY_PUBLIC_URL, ""));
        discoveryInput.setText(getPrefs().getString(KEY_DISCOVERY_URL, ""));
        setupScroll.setVisibility(View.VISIBLE);
    }

    private void connectToServer(String url) {
        activeBaseUrl = normalizeUrl(url);
        getPrefs().edit().putString(KEY_LAST_URL, activeBaseUrl).apply();
        setupScroll.setVisibility(View.GONE);
        webView.loadUrl(activeBaseUrl);
    }

    private void autoConnectBestEndpoint(boolean userTriggered) {
        if (autoConnecting) return;
        autoConnecting = true;
        if (userTriggered) {
            showSetupPanel("Mencoba Wi-Fi lokal & link Cloudflared...");
        }

        new Thread(() -> {
            SharedPreferences prefs = getPrefs();
            Set<String> candidates = new LinkedHashSet<>();

            String lanRaw = prefs.getString(KEY_LAN_URLS, DEFAULT_LAN_URLS);
            for (String item : lanRaw.split(",")) {
                String u = normalizeUrl(item);
                if (!u.isEmpty()) candidates.add(u);
            }
            String pub = normalizeUrl(prefs.getString(KEY_PUBLIC_URL, ""));
            if (!pub.isEmpty()) candidates.add(pub);

            String last = normalizeUrl(prefs.getString(KEY_LAST_URL, ""));
            if (!last.isEmpty()) candidates.add(last);

            String found = probeCandidates(new ArrayList<>(candidates));

            // Jika belum ketemu dan ada Discovery URL opsional, ambil link terbaru dari sana
            if (found == null) {
                String discUrl = normalizeUrl(prefs.getString(KEY_DISCOVERY_URL, ""));
                if (!discUrl.isEmpty()) {
                    String discovered = fetchDiscoveredTunnelUrl(discUrl);
                    if (discovered != null && isServerReachable(discovered, 3500)) {
                        found = discovered;
                        prefs.edit().putString(KEY_PUBLIC_URL, discovered).apply();
                    }
                }
            }

            final String target = found;
            runOnUiThread(() -> {
                autoConnecting = false;
                if (target != null) {
                    connectToServer(target);
                } else {
                    showSetupPanel("Server belum terjangkau.\nPastikan satu Wi-Fi (offline) atau isi link Cloudflared terbaru.");
                }
            });
        }).start();
    }

    private String probeCandidates(List<String> candidates) {
        // Prioritaskan URL Wi-Fi/LAN lokal dulu dengan timeout cepat (1.2 detik) agar instan saat offline
        for (String c : candidates) {
            if (c.startsWith("http://192.168.") || c.startsWith("http://10.") || c.startsWith("http://172.")) {
                if (isServerReachable(c, 1200)) return c;
            }
        }
        // Lalu cek link publik Cloudflared / lainnya
        for (String c : candidates) {
            if (!c.startsWith("http://192.168.") && !c.startsWith("http://10.") && !c.startsWith("http://172.")) {
                if (isServerReachable(c, 3500)) return c;
            }
        }
        return null;
    }

    private boolean isServerReachable(String baseUrl, int timeoutMs) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(baseUrl + "/api/info");
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(timeoutMs);
            conn.setReadTimeout(timeoutMs);
            conn.setRequestMethod("GET");
            if (conn.getResponseCode() == 200) {
                String body = readStream(conn);
                JSONObject json = new JSONObject(body);
                if ("linux-cloud-drive".equals(json.optString("app"))) {
                    cacheInfoEndpoints(json);
                    return true;
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (conn != null) conn.disconnect();
        }
        return false;
    }

    private String fetchDiscoveredTunnelUrl(String discUrl) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(discUrl).openConnection();
            conn.setConnectTimeout(3500);
            conn.setReadTimeout(3500);
            if (conn.getResponseCode() == 200) {
                String body = readStream(conn);
                try {
                    JSONObject obj = new JSONObject(body);
                    String fromJson = obj.optString("publicTunnelUrl", obj.optString("url", ""));
                    if (!fromJson.isEmpty()) return normalizeUrl(fromJson);
                } catch (Exception ignored) {}
                Matcher m = Pattern.compile("https://[a-zA-Z0-9-]+\\.trycloudflare\\.com").matcher(body);
                if (m.find()) return m.group(0);
            }
        } catch (Exception ignored) {
        } finally {
            if (conn != null) conn.disconnect();
        }
        return null;
    }

    private void syncEndpointsFromServer(String baseUrl) {
        if (baseUrl == null || baseUrl.isEmpty()) return;
        new Thread(() -> isServerReachable(baseUrl, 2500)).start();
    }

    private void cacheInfoEndpoints(JSONObject info) {
        try {
            SharedPreferences.Editor ed = getPrefs().edit();
            JSONArray nets = info.optJSONArray("networks");
            if (nets != null && nets.length() > 0) {
                StringBuilder sb = new StringBuilder();
                for (int i = 0; i < nets.length(); i++) {
                    String u = normalizeUrl(nets.getJSONObject(i).optString("url"));
                    if (!u.isEmpty()) {
                        if (sb.length() > 0) sb.append(",");
                        sb.append(u);
                    }
                }
                if (sb.length() > 0) ed.putString(KEY_LAN_URLS, sb.toString());
            }
            String pub = normalizeUrl(info.optString("publicTunnelUrl", ""));
            if (!pub.isEmpty()) {
                ed.putString(KEY_PUBLIC_URL, pub);
            }
            ed.apply();
        } catch (Exception ignored) {}
    }

    private String readStream(HttpURLConnection conn) throws Exception {
        try (BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream()))) {
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = br.readLine()) != null) sb.append(line);
            return sb.toString();
        }
    }

    private void setupWebView(WebView view) {
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }

        view.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView wv, String url) {
                super.onPageFinished(wv, url);
                if (!activeBaseUrl.isEmpty()) {
                    syncEndpointsFromServer(activeBaseUrl);
                }
            }

            @Override
            public void onReceivedError(WebView wv, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) {
                    autoConnectBestEndpoint(true);
                }
            }
        });

        view.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView wv, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = callback;
                try {
                    Intent intent = params.createIntent();
                    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                    startActivityForResult(intent, FILE_CHOOSER_REQ);
                } catch (Exception e) {
                    filePathCallback = null;
                    Toast.makeText(MainActivity.this, "Gagal membuka pemilih file", Toast.LENGTH_SHORT).show();
                    return false;
                }
                return true;
            }
        });

        view.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimeType, long contentLength) {
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);
                request.setMimeType(mimeType);
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
                DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                if (dm != null) {
                    dm.enqueue(request);
                    Toast.makeText(MainActivity.this, "Mengunduh " + fileName, Toast.LENGTH_SHORT).show();
                }
            }
        });

        view.setOnLongClickListener(v -> {
            WebView.HitTestResult res = view.getHitTestResult();
            if (res == null || res.getType() == WebView.HitTestResult.UNKNOWN_TYPE) {
                promptServerChange();
                return true;
            }
            return false;
        });
    }

    private void promptServerChange() {
        new AlertDialog.Builder(this)
                .setTitle("Pengaturan Server")
                .setMessage("Link tersimpan otomatis setiap kali terhubung ke server.")
                .setPositiveButton("Atur Server", (d, w) -> showSetupPanel("Atur alamat Wi-Fi atau Cloudflared:"))
                .setNegativeButton("Cari Otomatis", (d, w) -> autoConnectBestEndpoint(true))
                .setNeutralButton("Muat Ulang", (d, w) -> webView.reload())
                .show();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != FILE_CHOOSER_REQ || filePathCallback == null) {
            super.onActivityResult(requestCode, resultCode, data);
            return;
        }
        Uri[] results = null;
        if (resultCode == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                int count = data.getClipData().getItemCount();
                results = new Uri[count];
                for (int i = 0; i < count; i++) {
                    results[i] = data.getClipData().getItemAt(i).getUri();
                }
            } else if (data.getData() != null) {
                results = new Uri[]{data.getData()};
            }
        }
        filePathCallback.onReceiveValue(results);
        filePathCallback = null;
    }

    @Override
    public void onBackPressed() {
        if (setupScroll.getVisibility() == View.VISIBLE && webView.getUrl() != null) {
            setupScroll.setVisibility(View.GONE);
            return;
        }
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
