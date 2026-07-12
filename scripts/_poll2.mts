import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DBURL!);
const j = await sql`SELECT status, progress, stage, error FROM jobs ORDER BY created_at DESC LIMIT 1`;
const real = await sql`SELECT count(*)::int n FROM usage_events WHERE model NOT LIKE '%mock%'`;
console.log(`${j[0]?.status} ${j[0]?.progress}% "${j[0]?.stage}" ${(j[0]?.error||'').slice(0,60)} | realCalls=${real[0].n}`);
