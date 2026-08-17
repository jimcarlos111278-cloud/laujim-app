package com.laujim.aptmanager;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** Downloads Marketplace photos and produces small, browser-safe JPEG files. */
final class MarketplacePhotoUtils {
    private static final int MAX_DIMENSION = 2048;
    private static final long MAX_OUTPUT_BYTES = 2L * 1024L * 1024L;

    private MarketplacePhotoUtils() { }

    static File downloadAndPrepare(String source, File directory, String baseName,
                                   int connectTimeoutMs, int readTimeoutMs) throws Exception {
        File raw = File.createTempFile("marketplace-source-", ".bin", directory);
        File output = new File(directory, baseName + ".jpg");
        try {
            download(source, raw, connectTimeoutMs, readTimeoutMs);
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeFile(raw.getAbsolutePath(), bounds);
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
                throw new IllegalArgumentException("El archivo no es una imagen legible");
            }

            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight);
            options.inPreferredConfig = Bitmap.Config.ARGB_8888;
            Bitmap bitmap = BitmapFactory.decodeFile(raw.getAbsolutePath(), options);
            if (bitmap == null) throw new IllegalArgumentException("No se pudo decodificar la imagen");
            boolean withinLimit = false;
            Bitmap prepared = bitmap;
            try {
                int largestSide = Math.max(prepared.getWidth(), prepared.getHeight());
                if (largestSide > MAX_DIMENSION) {
                    float scale = MAX_DIMENSION / (float) largestSide;
                    int width = Math.max(1, Math.round(prepared.getWidth() * scale));
                    int height = Math.max(1, Math.round(prepared.getHeight() * scale));
                    Bitmap smaller = Bitmap.createScaledBitmap(prepared, width, height, true);
                    if (smaller != prepared) {
                        prepared.recycle();
                        prepared = smaller;
                    }
                }
                for (int pass = 0; pass < 4 && !withinLimit; pass += 1) {
                    for (int quality : new int[] { 84, 74, 64, 54, 44 }) {
                        if (output.exists()) output.delete();
                        try (FileOutputStream stream = new FileOutputStream(output)) {
                            if (!prepared.compress(Bitmap.CompressFormat.JPEG, quality, stream)) {
                                throw new IllegalStateException("No se pudo comprimir la imagen");
                            }
                        }
                        if (output.length() <= MAX_OUTPUT_BYTES) {
                            withinLimit = true;
                            break;
                        }
                    }
                    if (!withinLimit && pass < 3) {
                        int width = Math.max(1, Math.round(prepared.getWidth() * 0.82f));
                        int height = Math.max(1, Math.round(prepared.getHeight() * 0.82f));
                        Bitmap smaller = Bitmap.createScaledBitmap(prepared, width, height, true);
                        if (smaller != prepared) prepared.recycle();
                        prepared = smaller;
                    }
                }
            } finally {
                prepared.recycle();
            }
            if (!output.exists() || output.length() == 0) {
                throw new IllegalStateException("La imagen comprimida quedó vacía");
            }
            if (!withinLimit || output.length() > MAX_OUTPUT_BYTES) {
                throw new IllegalStateException("La imagen supera 2 MB despues de comprimirla");
            }
            if (output.length() > MAX_OUTPUT_BYTES) {
                throw new IllegalStateException("La imagen sigue superando 10 MB después de comprimirla");
            }
            return output;
        } finally {
            if (raw.exists()) raw.delete();
        }
    }

    private static int sampleSize(int width, int height) {
        int sample = 1;
        while (Math.max(width / (sample * 2), height / (sample * 2)) >= MAX_DIMENSION) {
            sample *= 2;
        }
        return sample;
    }

    private static void download(String source, File target, int connectTimeoutMs,
                                 int readTimeoutMs) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(source).openConnection();
        connection.setConnectTimeout(connectTimeoutMs);
        connection.setReadTimeout(readTimeoutMs);
        connection.setRequestProperty("Accept", "image/*");
        try {
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw new IllegalStateException("Foto HTTP " + status);
            try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(target)) {
                byte[] buffer = new byte[16 * 1024];
                int read;
                while ((read = input.read(buffer)) >= 0) output.write(buffer, 0, read);
            }
        } finally {
            connection.disconnect();
        }
    }
}
