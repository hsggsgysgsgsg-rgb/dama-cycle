const admin = require("firebase-admin");

const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.DATABASE_URL,
});

const db = admin.database();

const CYCLE_MS = 100 * 3600 * 1000;
const PAUSE_MS = 3 * 24 * 3600 * 1000;
const RANK_REWARDS = [700,650,600,586,571,557,543,529,514,500,490,480,470,460,450,440,430,420,410,400,393,387,380,373,367,360,353,347,340,333,327,320,313,307,300,293,287,280,273,267,260,253,247,240,233,227,220,213,207,200,196,192,188,184,180,176,172,168,164,160,156,152,148,144,140,136,132,128,124,120,116,112,108,104,100,98,96,94,92,90,88,86,84,82,80,78,76,74,72,70,68,66,64,62,60,58,56,54,52,50];

function rankReward(rank) {
  if (rank < 1) return 0;
  if (rank <= RANK_REWARDS.length) return RANK_REWARDS[rank - 1];
  return RANK_REWARDS[RANK_REWARDS.length - 1];
}

async function distributeRewards() {
  const playersSnap = await db.ref("players").once("value");
  const list = [];
  playersSnap.forEach((c) => {
    list.push({ id: c.key, pts: (c.val() && c.val().onlineSeasonPoints) || 0 });
  });
  list.sort((a, b) => b.pts - a.pts);

  const updates = {};
  const rankField = ["rank1", "rank2", "rank3"];
  list.forEach((u, i) => {
    if (u.pts <= 0) return;
    const rank = i + 1;
    const bonus = rankReward(rank);
    updates[`players/${u.id}/points`] = admin.database.ServerValue.increment(u.pts + bonus);
    if (rank <= 3) {
      updates[`players/${u.id}/${rankField[rank - 1]}`] = admin.database.ServerValue.increment(1);
    }
  });
  playersSnap.forEach((c) => {
    updates[`players/${c.key}/onlineSeasonPoints`] = 0;
  });

  if (Object.keys(updates).length) {
    await db.ref().update(updates);
  }
}

async function main() {
  const cycleRef = db.ref("onlineCycle");
  const snap = await cycleRef.once("value");
  const v = snap.val();
  const now = Date.now();

  if (!v || !v.start) {
    await cycleRef.set({ start: now });
    console.log("initialized cycle");
    process.exit(0);
  }

  if (now < v.start + CYCLE_MS) {
    console.log("cycle still active");
    process.exit(0);
  }

  if (!v.waitStart) {
    const result = await cycleRef.child("waitStart").transaction((cur) => {
      if (cur) return;
      return now;
    });
    if (result.committed) {
      await distributeRewards();
      console.log("rewards distributed");
    } else {
      console.log("already handled by a previous run");
    }
    process.exit(0);
  }

  if (now >= v.waitStart + PAUSE_MS) {
    await cycleRef.transaction((cur) => {
      const ws = cur && cur.waitStart;
      if (!ws) return;
      if (now < ws + PAUSE_MS) return;
      return { start: ws + PAUSE_MS, waitStart: null };
    });
    console.log("new cycle started");
    process.exit(0);
  }

  console.log("waiting period");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
