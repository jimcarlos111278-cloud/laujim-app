package com.laujim.aptmanager;

import android.content.ContentResolver;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** Produces browser-safe JPEG files with a strict 2 MB limit. */
final class MarketplacePhotoUtils {
    private static final int MAX_DIMENSION = 2048;
    // Keep a margin under Facebook's 20 MB batch/file validation when several
    // photos are attached together, while staying visually close to 2 MB.
    private static final long MAX_OUTPUT_BYTES = 1_900_000L;

    private MarketplacePhotoUtils() { }

    static File downloadAndPrepare(String source, File directory, String baseName,
                                   int connectTimeoutMs, int readTimeoutMs) throws Exception {
        File raw = File.createTempFile("marketplace-source-", ".bin", directory);
        try {
            download(source, raw, connectTimeoutMs, readTimeoutMs);
            return prepareRaw(raw, new File(directory, baseName + ".jpg"));
        } finally {
            if (raw.exists()) raw.delete();
        }
    }

    static File prepareUri(ContentResolver resolver, Uri source, File directory,
                           String baseName) throws Exception {
        if (resolver == null || source == null) throw new IllegalArgumentException("Foto sin origen");
        File raw = File.createTempFile("marketplace-picker-", ".bin", directory);
        try {
            try (InputStream input = resolver.openInputStream(source)) {
                if (input == null) throw new IllegalArgumentException("No se pudo leer la foto seleccionada");
                try (FileOutputStream output = new FileOutputStream(raw)) {
                    copy(input, output);
                }
            }
            if (raw.length() == 0) throw new IllegalArgumentException("La foto seleccionada está vacía");
            return prepareRaw(raw, new File(directory, baseName + ".jpg"));
        } finally {
            if (raw.exists()) raw.delete();
        }
    }

    private static File prepareRaw(File raw, File output) throws Exception {
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
            throw new IllegalStateException("La imagen supera 2 MB después de comprimirla");
        }
        return output;
    }

    private static int sampleSize(int width, int height) {
        int sample = 1;
        while (Math.max(width / sample, height / sample) > MAX_DIMENSION * 2) sample *= 2;
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
                copy(input, output);
            }
        } finally {
            connection.disconnect();
        }
    }

    private static void copy(InputStream input, FileOutputStream output) throws Exception {
        byte[] buffer = new byte[16 * 1024];
        int read;
        while ((read = input.read(buffer)) > 0) output.write(buffer, 0, read);
    }
}
