package dev.arstuff.messpass;

import android.graphics.Bitmap;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import com.google.android.material.datepicker.MaterialDatePicker;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

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
            webView.addJavascriptInterface(new DatePickerBridge(), "AndroidDatePicker");
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

    private class DatePickerBridge {
        @JavascriptInterface
        public void open(final String initialIso) {
            runOnUiThread(() -> {
                long selection = MaterialDatePicker.todayInUtcMilliseconds();
                if (initialIso != null && !initialIso.isEmpty()) {
                    try {
                        SimpleDateFormat fmt = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
                        fmt.setTimeZone(TimeZone.getTimeZone("UTC"));
                        Date parsed = fmt.parse(initialIso);
                        if (parsed != null) {
                            selection = parsed.getTime();
                        }
                    } catch (Exception ignored) {
                        // Fall back to today
                    }
                }

                MaterialDatePicker<Long> picker = MaterialDatePicker.Builder.datePicker()
                    .setTitleText("Select Date")
                    .setSelection(selection)
                    .build();

                picker.addOnPositiveButtonClickListener(utcMillis -> {
                    SimpleDateFormat outFmt = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
                    outFmt.setTimeZone(TimeZone.getTimeZone("UTC"));
                    String iso = outFmt.format(new Date(utcMillis));
                    WebView currentWebView = getBridge().getWebView();
                    if (currentWebView != null) {
                        currentWebView.evaluateJavascript(
                            "window.__onAndroidDatePicked && window.__onAndroidDatePicked('" + iso + "')",
                            null
                        );
                    }
                });

                picker.show(getSupportFragmentManager(), "MESSPASS_DATE_PICKER");
            });
        }
    }
}
