import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { PostgresDatabase, migrateDatabase } from '../db/postgres.js';
import { createApp } from '../app.js';

// Real Postgres dialect with a single connection, no production Neon mutations.
test('CMS setup, publication, roles, and session invalidation', async () => {
  const engine=new PGlite();
  const pool={query:(q,p)=>engine.query(q,p),connect:async()=>({query:(q,p)=>engine.query(q,p),release(){}}),end:()=>engine.close()};
  const db=new PostgresDatabase(pool);
  process.env.JWT_SECRET='cms-test-secret-with-more-than-32-characters';
  try {
    await migrateDatabase(db,new URL('../../osr-website/index.html',import.meta.url).pathname);
    const app=createApp(db);
    const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});
    try {
      const base=`http://127.0.0.1:${server.address().port}`;
      const call=async(path,method='GET',body,cookie)=>{
        const res=await fetch(base+path,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});
        return {status:res.status,body:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
      };
      assert.equal((await call('/api/auth/setup-status')).body.needsSetup,true);
      const email='owner@example.org',password='SecureOwner123!';
      assert.equal((await call('/api/auth/setup','POST',{email,password,name:'Owner'})).status,200);
      assert.equal((await call('/api/auth/setup','POST',{email:'other@example.org',password})).status,403);
      assert.equal((await call('/api/announcements')).status,401);
      assert.equal((await call('/api/settings')).status,401);
      assert.equal((await call('/api/announcements','POST',{title:'No'})).status,401);
      const login=await call('/api/auth/login','POST',{email,password});
      const cookie=login.cookie;
      assert.ok(cookie);
      assert.equal((await call('/api/announcements','POST',{title:'Invalid',status:'Sneaky'},cookie)).status,400);
      const create=await call('/api/announcements','POST',{title:'CMS integration',status:'Draft'},cookie);
      assert.equal(create.status,200);
      const id=create.body.id;
      assert.ok(!(await call('/api/public/announcements')).body.some(x=>x.id===id));
      assert.equal((await call(`/api/announcements/${id}`)).status,401);
      assert.equal((await call(`/api/announcements/${id}`,'PATCH',{title:'Published CMS integration',status:'Published'},cookie)).status,200);
      assert.ok((await call('/api/public/announcements')).body.some(x=>x.id===id&&x.title==='Published CMS integration'));
      await call(`/api/announcements/${id}`,'PATCH',{status:'Draft'},cookie);
      assert.ok(!(await call('/api/public/announcements')).body.some(x=>x.id===id));
      const created=await call('/api/admin-users','POST',{name:'Editor',email:'editor@example.org',role:'admin'},cookie);
      assert.equal(created.status,200);
      const editor=(await call('/api/auth/login','POST',{email:'editor@example.org',password:created.body.temporaryPassword})).cookie;
      assert.equal((await call('/api/settings','PATCH',{site_title:'Bad'},editor)).status,403);
      assert.equal((await call('/api/admin-users', 'GET',null,editor)).status,403);
      assert.equal((await call('/api/resources','POST',{title:'Allowed editor resource'},editor)).status,200);
      const changed=await call('/api/auth/account','PATCH',{currentPassword:password,newPassword:'AnotherSecure123!',confirmPassword:'AnotherSecure123!'},cookie);
      assert.equal(changed.status,200);
      assert.equal((await call('/api/auth/me','GET',null,cookie)).status,401);
      assert.equal((await call('/api/auth/login','POST',{email,password})).status,401);
      assert.equal((await call('/api/auth/login','POST',{email,password:'AnotherSecure123!'})).status,200);
    } finally {await new Promise(resolve=>server.close(resolve))}
  } finally {await db.close()}
});
