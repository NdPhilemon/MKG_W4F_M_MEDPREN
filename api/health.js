import admin from "firebase-admin";
import { initFirebase } from "./firebase-init.js";

export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  try{
    initFirebase();
    const db=admin.firestore();
    await db.collection("mmedpren").doc("global").get();
    return res.status(200).json({
      ok:true,
      provider:"firebase",
      firestore:true,
    });
  }catch(error){
    console.error("HEALTH_CHECK_ERROR",{code:error?.code});
    return res.status(500).json({
      ok:false,
      provider:"firebase",
      firestore:false,
      error:"Service Firebase indisponible"
    });
  }
}
