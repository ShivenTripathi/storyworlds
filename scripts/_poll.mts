import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DBURL!);
const j = await sql`SELECT status, progress, stage, error FROM jobs ORDER BY created_at DESC LIMIT 1`;
const u = await sql`SELECT model FROM usage_events WHERE model NOT LIKE '%mock%' LIMIT 1`;
console.log(`${j[0]?.status} ${j[0]?.progress}% "${j[0]?.stage}" ${j[0]?.error||''} | realGemini=${u.length>0}`);
