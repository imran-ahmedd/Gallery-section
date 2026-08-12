/**
 * Firestore ডেটা মাইগ্রেশন স্ক্রিপ্ট
 * এক Firebase প্রজেক্ট থেকে আরেক Firebase প্রজেক্টে সব ডেটা কপি করে
 * (সব collection + subcollection, recursively)
 *
 * ব্যবহার করার আগে অবশ্যই README.md পড়ে নাও।
 */

const admin = require("firebase-admin");

// ==========================================================================
// ১. দুটো প্রজেক্টের Service Account key ফাইলের নাম বসাও
// ==========================================================================
const SOURCE_KEY_FILE = "./source-service-account.json";      // পুরাতন প্রজেক্ট (teachinglearning01)
const TARGET_KEY_FILE = "./target-service-account.json";      // নতুন প্রজেক্ট (tvcourse1)

// ==========================================================================
// ২. দুটো আলাদা Firebase App ইনিশিয়ালাইজ করা হচ্ছে
// ==========================================================================
const sourceApp = admin.initializeApp(
  {
    credential: admin.credential.cert(require(SOURCE_KEY_FILE)),
  },
  "sourceApp"
);

const targetApp = admin.initializeApp(
  {
    credential: admin.credential.cert(require(TARGET_KEY_FILE)),
  },
  "targetApp"
);

const sourceDb = sourceApp.firestore();
const targetDb = targetApp.firestore();

// ব্যাচ রাইট লিমিট (Firestore এর প্রতি ব্যাচে সর্বোচ্চ ৫০০টা অপারেশন)
const BATCH_LIMIT = 400;

let totalDocsCopied = 0;
let totalCollectionsCopied = 0;

/**
 * একটা collection এর সব ডকুমেন্ট কপি করে, এবং প্রতিটা ডকুমেন্টের
 * ভেতরের subcollection গুলোও recursively কপি করে।
 *
 * @param {FirebaseFirestore.CollectionReference} sourceCollectionRef
 * @param {FirebaseFirestore.CollectionReference} targetCollectionRef
 * @param {string} pathLabel - শুধু লগ দেখানোর জন্য
 */
async function copyCollection(sourceCollectionRef, targetCollectionRef, pathLabel) {
  const snapshot = await sourceCollectionRef.get();

  if (snapshot.empty) {
    console.log(`  (খালি) ${pathLabel}`);
    return;
  }

  console.log(`▶ কপি হচ্ছে: ${pathLabel}  (${snapshot.size}টা ডকুমেন্ট)`);

  let batch = targetDb.batch();
  let opsInBatch = 0;

  for (const doc of snapshot.docs) {
    const targetDocRef = targetCollectionRef.doc(doc.id);
    batch.set(targetDocRef, doc.data());
    opsInBatch++;
    totalDocsCopied++;

    if (opsInBatch >= BATCH_LIMIT) {
      await batch.commit();
      batch = targetDb.batch();
      opsInBatch = 0;
    }
  }

  if (opsInBatch > 0) {
    await batch.commit();
  }

  totalCollectionsCopied++;

  // এখন প্রতিটা ডকুমেন্টের subcollection চেক করা হচ্ছে
  for (const doc of snapshot.docs) {
    const sourceDocRef = sourceCollectionRef.doc(doc.id);
    const targetDocRef = targetCollectionRef.doc(doc.id);

    const subcollections = await sourceDocRef.listCollections();
    for (const subcol of subcollections) {
      await copyCollection(
        subcol,
        targetDocRef.collection(subcol.id),
        `${pathLabel}/${doc.id}/${subcol.id}`
      );
    }
  }
}

async function migrate() {
  console.log("🚀 Firestore মাইগ্রেশন শুরু হচ্ছে...\n");

  const rootCollections = await sourceDb.listCollections();

  if (rootCollections.length === 0) {
    console.log("সোর্স ডাটাবেজে কোনো collection পাওয়া যায়নি।");
    return;
  }

  console.log(`মোট ${rootCollections.length}টা root collection পাওয়া গেছে:`);
  rootCollections.forEach((c) => console.log(`  - ${c.id}`));
  console.log("");

  for (const col of rootCollections) {
    await copyCollection(col, targetDb.collection(col.id), col.id);
  }

  console.log("\n✅ মাইগ্রেশন সম্পন্ন হয়েছে!");
  console.log(`   মোট collection: ${totalCollectionsCopied}`);
  console.log(`   মোট ডকুমেন্ট কপি হয়েছে: ${totalDocsCopied}`);
}

migrate()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ এরর হয়েছে:", err);
    process.exit(1);
  });
