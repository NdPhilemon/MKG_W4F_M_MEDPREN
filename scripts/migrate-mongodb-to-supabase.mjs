import { MongoClient } from "mongodb";
import { createClient } from "@supabase/supabase-js";

const {
  MONGODB_URI,
  SUPABASE_URL,
  SUPABASE_SECRET_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

const SUPABASE_KEY = SUPABASE_SECRET_KEY || SUPABASE_SERVICE_ROLE_KEY;

if (!MONGODB_URI || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    "Variables requises: MONGODB_URI, SUPABASE_URL, SUPABASE_SECRET_KEY"
  );
  process.exit(1);
}

const mongo = new MongoClient(MONGODB_URI);
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function stripMongo(v) {
  if (Array.isArray(v)) return v.map(stripMongo);
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      if (k === "_id") continue;
      out[k] = stripMongo(val);
    }
    return out;
  }
  return v;
}

async function main() {
  await mongo.connect();
  const db = mongo.db("mmedpren");

  const meta = (await db.collection("app_meta").findOne({ _id: "global" })) || {};
  const names = ["shops", "users", "products", "ads", "sales", "orders", "notifications"];
  const data = {};

  for (const name of names) {
    data[name] = stripMongo(await db.collection(name).find({}).toArray());
  }

  const appState = {
    id: "global",
    revision: Number(meta.revision || 0),
    rate: Number(meta.rate || 2400),
    main_currency: meta.mainCurrency || "USD",
    hide_money: !!meta.hideMoney,
    shop_settings: stripMongo(meta.shopSettings || {}),
    admin_profile: stripMongo(meta.adminProfile || {}),
    shops: data.shops,
    users: data.users.map(({ password, ...u }) => u),
    products: data.products,
    ads: data.ads,
    sales: data.sales,
    notifications: data.notifications,
    updated_at: new Date().toISOString(),
  };

  const { error: stateError } = await supabase
    .from("app_state")
    .upsert(appState, { onConflict: "id" });

  if (stateError) throw stateError;

  const orderRows = data.orders
    .filter((o) => o?.id)
    .map((o) => ({
      id: o.id,
      visitor_session_id: o.visitorSessionId || null,
      status: o.status || "waiting",
      claimed_by_id: o.claimedById || null,
      claimed_by_name: o.claimedByName || null,
      payload: o,
      updated_at: o.updatedAt || new Date().toISOString(),
    }));

  if (orderRows.length) {
    const { error: orderError } = await supabase
      .from("orders")
      .upsert(orderRows, { onConflict: "id" });

    if (orderError) throw orderError;
  }

  console.log("Migration terminée.");
  console.log(`Produits: ${data.products.length}`);
  console.log(`Utilisateurs: ${data.users.length}`);
  console.log(`Ventes: ${data.sales.length}`);
  console.log(`Commandes: ${data.orders.length}`);

  await mongo.close();
}

main().catch(async (e) => {
  console.error(e);
  try { await mongo.close(); } catch {}
  process.exit(1);
});
