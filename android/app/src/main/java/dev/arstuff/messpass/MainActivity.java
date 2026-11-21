package dev.arstuff.messpass;

import android.graphics.Bitmap;
import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        WebView webView = this.bridge.getWebView();
        if (webView != null) {
            webView.setWebChromeClient(new BridgeWebChromeClient(this.bridge) {
                @Override
                public Bitmap getDefaultVideoPoster() {
                    return Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
                }
            });
        }

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView currentWebView = getBridge().getWebView();
                if (currentWebView == null) {
                    moveTaskToBack(true);
                    return;
                }
                currentWebView.evaluateJavascript(
                    "(window.__handleAndroidBack && window.__handleAndroidBack()) ? '1' : '0'",
                    value -> {
                        if (!"\"1\"".equals(value)) {
                            moveTaskToBack(true);
                        }
                    }
                );
            }
        });
    }
}
