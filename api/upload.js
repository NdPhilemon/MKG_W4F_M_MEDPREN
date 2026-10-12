import admin from "firebase-admin";
import crypto from "node:crypto";
import { initFirebase } from "./firebase-init.js";
import { authenticate } from "./sync.js";

const GLOBAL_CACHE_KEY = "__mmedprenFirebaseBucketName";

function normalizeBucketName(value) {
  return String(value || "")
    .trim()
    .replace(/^gs:\/\//i, "")
    .replace(/^https?:\/\/storage\.googleapis\.com\//i, "")
    .replace(/\/+$/, "");
}

async function bucketExists(app, name) {
  if (!name) return null;

  try {
    const bucket = admin.storage(app).bucket(name);
    await bucket.getMetadata();
    return bucket;
  } catch (error) {
    const code = Number(
      error?.code ||
      error?.response?.statusCode ||
      0
    );

    if (code === 404) return null;

    if (code === 401 || code === 403) {
      return admin.storage(app).bucket(name);
    }

    return null;
  }
}

async function listProjectBuckets(app, projectId) {
  try {
    const credential = app.options.credential;

    if (!credential?.getAccessToken) {
      return [];
    }

    const tokenResult = await credential.getAccessToken();

    const token =
      typeof tokenResult === "string"
        ? tokenResult
        : tokenResult?.access_token;

    if (!token) return [];

    const response = await fetch(
      `https://storage.googleapis.com/storage/v1/b?project=${encodeURIComponent(projectId)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    if (!response.ok) return [];

    const json = await response.json();

    return Array.isArray(json?.items)
      ? json.items.map(item => item?.name).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

async function resolveBucket(app) {
  const cached = globalThis[GLOBAL_CACHE_KEY];

  if (cached) {
    return admin.storage(app).bucket(cached);
  }

  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    app.options.projectId ||
    "";

  const configured = normalizeBucketName(
    process.env.FIREBASE_STORAGE_BUCKET
  );

  const candidates = [
    configured,
    projectId
      ? `${projectId}.firebasestorage.app`
      : "",
    projectId
      ? `${projectId}.appspot.com`
      : ""
  ].filter(Boolean);

  for (const name of [...new Set(candidates)]) {
    const bucket = await bucketExists(app, name);

    if (bucket) {
      globalThis[GLOBAL_CACHE_KEY] = bucket.name;
      return bucket;
    }
  }

  const discovered = await listProjectBuckets(
    app,
    projectId
  );

  if (discovered.length) {
    const preferred =
      discovered.find(
        name =>
          name.endsWith(".firebasestorage.app")
      ) ||
      discovered.find(
        name =>
          name.endsWith(".appspot.com")
      ) ||
      discovered[0];

    const bucket =
      admin.storage(app).bucket(preferred);

    globalThis[GLOBAL_CACHE_KEY] = preferred;

    return bucket;
  }

  throw new Error(
    "Aucun bucket Firebase Storage n'existe pour ce projet. " +
    "Ouvrez Firebase Console > Storage et terminez la création du bucket."
  );
}

export default async function handler(req, res) {
  res.setHeader(
    "Cache-Control",
    "no-store"
  );

  try {
    const app = initFirebase();

    if (req.method !== "POST") {
      return res.status(405).json({
        ok: false,
        error: "Méthode non autorisée"
      });
    }

    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : req.body || {};

    const dataUrl = body.dataUrl;
    const identity = await authenticate(req.headers["x-sync-token"]);
    const allowed = identity.role === "admin" || (body.folder !== "ads" && identity.user.permissions?.includes("products.edit"));
    if (!allowed) return res.status(403).json({ok:false,error:"Upload non autorisé"});

    const requestedFolder =
      String(body.folder || "products")
        .replace(
          /[^a-zA-Z0-9_-]/g,
          ""
        ) || "products";

    if (
      !dataUrl ||
      typeof dataUrl !== "string" ||
      !dataUrl.startsWith("data:image/")
    ) {
      return res.status(400).json({
        ok: false,
        error: "Image invalide"
      });
    }

    const match = dataUrl.match(
      /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/
    );

    if (!match) {
      return res.status(400).json({
        ok: false,
        error: "Format d'image invalide"
      });
    }

    const mime = match[1];

    const buffer = Buffer.from(
      match[2],
      "base64"
    );

    if (!buffer.length) {
      return res.status(400).json({
        ok: false,
        error: "Image vide"
      });
    }

    if (
      buffer.length >
      3 * 1024 * 1024
    ) {
      return res.status(413).json({
        ok: false,
        error:
          "Image trop volumineuse (maximum 3 Mo)"
      });
    }

    const ext =
      mime.includes("png")
        ? "png"
        : mime.includes("webp")
        ? "webp"
        : mime.includes("gif")
        ? "gif"
        : "jpg";

    const bucket =
      await resolveBucket(app);

    const filename =
      `${requestedFolder}/` +
      `${Date.now()}-${crypto.randomUUID()}.${ext}`;

    const file =
      bucket.file(filename);

    const downloadToken =
      crypto.randomUUID();

    await file.save(buffer, {
      resumable: false,
      contentType: mime,

      metadata: {
        cacheControl:
          "public,max-age=31536000",

        metadata: {
          firebaseStorageDownloadTokens:
            downloadToken
        }
      }
    });

    const url =
      `https://firebasestorage.googleapis.com/v0/b/` +
      `${encodeURIComponent(bucket.name)}/o/` +
      `${encodeURIComponent(filename)}` +
      `?alt=media&token=${encodeURIComponent(downloadToken)}`;

    return res.status(200).json({
      ok: true,
      provider: "firebase",
      bucket: bucket.name,
      path: filename,
      url
    });

  } catch (error) {
    console.error(
      "FIREBASE_STORAGE_UPLOAD",
      {
        message: error?.message,
        code: error?.code
      }
    );

    return res.status(error.status || 500).json({
      ok: false,
      error:
        error.status ? error.message : "La photo n'a pas pu être enregistrée dans Firebase Storage."
    });
  }
}
