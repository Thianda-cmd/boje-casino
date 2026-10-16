import { auth, cfg, createAccount, deleteUser, rpc } from './_lib/supa.js'

/*
  End-to-end check of the live backend: Crash, Live Blackjack (on the hidden test table 99), Case Battles (on
  battles of g_selftest guests, which the lobby lists leave out) and accounts: sign-up, sign-in, profile and wallet
  saves, then removes the test account. Only answers when ?key= matches the SELFTEST_KEY env var; reports pass/fail
  only.
*/

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store')
  const key = process.env.SELFTEST_KEY
  if (!key || req.query?.key !== key) return res.status(404).json({ error: 'not-found' })
  const c = cfg()
  const steps = []
  const step = async (name, fn) => {
    const t0 = Date.now()
    try {
      const detail = await fn()
      steps.push({ name, ok: true, ms: Date.now() - t0, detail })
      return detail
    } catch (e) {
      steps.push({ name, ok: false, ms: Date.now() - t0, detail: String(e?.message || e).slice(0, 200) })
      return null
    }
  }
  const must = (cond, msg) => {
    if (!cond) throw new Error(msg)
  }

  await step('config', async () => {
    must(c.url && c.anon && c.service, 'missing settings')
    return { url: !!c.url, anon: c.anon.startsWith('eyJ') ? 'jwt' : 'sb', service: c.service.startsWith('eyJ') ? 'jwt' : 'sb' }
  })
  await step('auth settings', async () => {
    const r = await auth('/settings')
    must(r.ok, `status ${r.status}`)
    return { autoconfirm: r.body?.mailer_autoconfirm, signup_disabled: r.body?.disable_signup }
  })
  await step('crash_state as guest', async () => {
    const r = await rpc('crash_state', { p_player: 'g_selftest0000000000' })
    must(r.ok && r.body?.round?.id, `status ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`)
    return { round: r.body.round.id, phase: r.body.round.phase, history: r.body.history.length }
  })
  await step('direct table read is blocked', async () => {
    const r = await fetch(`${c.url}/rest/v1/crash_round?select=seed&limit=1`, { headers: { apikey: c.anon, ...(c.anon.startsWith('eyJ') ? { authorization: `Bearer ${c.anon}` } : {}) } })
    must(r.status === 401 || r.status === 403 || r.status === 404, `status ${r.status}`)
    return { status: r.status }
  })

  const bjGuest = 'g_selftest' + Math.random().toString(36).slice(2, 12).padEnd(10, '0')
  await step('bj_tables as guest', async () => {
    const r = await rpc('bj_tables', { p_player: bjGuest, p_sid: null })
    must(r.ok && Array.isArray(r.body?.tables) && r.body.tables.length >= 1 && !r.body.tables.some((t) => t.id === 99), `status ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`)
    return { tables: r.body.tables.length }
  })
  await step('bj_state on the test table', async () => {
    const r = await rpc('bj_state', { p_table: 99, p_player: bjGuest, p_sid: null, p_etag: null })
    must(r.ok && r.body?.round?.id && !JSON.stringify(r.body).includes('"shoe"'), `status ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`)
    return { round: r.body.round.id, phase: r.body.round.phase }
  })
  await step('direct read of bj_table is blocked', async () => {
    const r = await fetch(`${c.url}/rest/v1/bj_table?select=shoe&limit=1`, { headers: { apikey: c.anon, ...(c.anon.startsWith('eyJ') ? { authorization: `Bearer ${c.anon}` } : {}) } })
    must(r.status === 401 || r.status === 403 || r.status === 404, `status ${r.status}`)
    return { status: r.status }
  })
  await step('internal bj function is blocked', async () => {
    const r = await rpc('_bj_advance', { t_id: 99, now_ms: 0 })
    must(!r.ok, `status ${r.status}`)
    return { status: r.status }
  })
  await step('bj_sit + bj_leave on the test table', async () => {
    for (let seat = 1; seat <= 5; seat++) {
      const s = await rpc('bj_sit', { p_table: 99, p_seat: seat, p_player: bjGuest, p_sid: null, p_name: 'Selftest', p_avatar: 0 })
      if (s.body?.error === 'taken') continue
      must(s.ok && s.body?.ok && s.body.sid, `status ${s.status} ${JSON.stringify(s.body).slice(0, 120)}`)
      const l = await rpc('bj_leave', { p_table: 99, p_player: bjGuest, p_sid: s.body.sid })
      must(l.ok && l.body?.ok, `leave ${l.status}`)
      return { seat }
    }
    return { seat: null, note: 'test table full' }
  })

  // Case Battles: a g_selftest guest's battles are left out of the lobby lists, so no player sees or joins them
  const cbGuest = () => 'g_selftest' + Math.random().toString(36).slice(2, 12).padEnd(10, '0')
  const cbA = cbGuest()
  const cbB = cbGuest()
  const cbOk = (r, what) => must(r.ok && r.body?.ok, `${what}: status ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`)
  await step('cb_list as guest', async () => {
    const r = await rpc('cb_list', { p_player: cbA })
    must(r.ok && ['open', 'live', 'recent', 'mine'].every((k) => Array.isArray(r.body?.[k])) && r.body.mine.length === 0, `status ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`)
    return { open: r.body.open.length, live: r.body.live.length, recent: r.body.recent.length }
  })
  await step('direct read of cb_battle is blocked', async () => {
    const r = await fetch(`${c.url}/rest/v1/cb_battle?select=results&limit=1`, { headers: { apikey: c.anon, ...(c.anon.startsWith('eyJ') ? { authorization: `Bearer ${c.anon}` } : {}) } })
    must(r.status === 401 || r.status === 403 || r.status === 404, `status ${r.status}`)
    return { status: r.status }
  })
  await step('internal cb function is blocked', async () => {
    const r = await rpc('_cb_start', { p_battle: 0, now_ms: 0 })
    must(!r.ok, `status ${r.status}`)
    return { status: r.status }
  })
  await step('cb_create, cb_join, cb_leave on a hidden battle (cancelled)', async () => {
    const made = await rpc('cb_create', { p_player: cbA, p_name: 'Selftest', p_avatar: 0, p_mode: '1v1v1', p_crazy: false, p_unit: 1, p_cases: ['low'] })
    cbOk(made, 'create')
    const id = made.body.battle.id
    must(made.body.battle.status === 'open' && made.body.battle.seats[0]?.me === true && made.body.battle.cost === 1, 'created battle')
    const lobby = await rpc('cb_list', { p_player: cbB })
    must(lobby.ok && !lobby.body.open.some((b) => b.id === id), 'the selftest battle is listed')
    const joined = await rpc('cb_join', { p_battle: id, p_player: cbB, p_name: 'Selftest', p_avatar: 1, p_seat: 3 })
    cbOk(joined, 'join')
    must(joined.body.battle.status === 'open' && joined.body.battle.seats[2]?.me === true, 'joined seat 3')
    const left = await rpc('cb_leave', { p_battle: id, p_player: cbB })
    must(left.body?.ok && left.body.cancelled === false, `leave ${JSON.stringify(left.body)}`)
    must((await rpc('cb_result', { p_battle: id, p_player: cbB })).body?.state === 'none', 'result after leaving')
    const cancelled = await rpc('cb_leave', { p_battle: id, p_player: cbA })
    must(cancelled.body?.ok && cancelled.body.cancelled === true, `creator leave ${JSON.stringify(cancelled.body)}`)
    must((await rpc('cb_result', { p_battle: id, p_player: cbA })).body?.state === 'cancelled', 'result after cancelling')
    must((await rpc('cb_state', { p_battle: id, p_player: cbA })).body?.status === 'cancelled', 'state after cancelling')
    must((await rpc('cb_join', { p_battle: id, p_player: cbB, p_name: 'Selftest', p_avatar: 1, p_seat: null })).body?.error === 'started', 'join a cancelled battle')
    return { id }
  })
  await step('cb_bots plays a hidden battle', async () => {
    const made = await rpc('cb_create', { p_player: cbA, p_name: 'Selftest', p_avatar: 0, p_mode: '1v1', p_crazy: false, p_unit: 1, p_cases: ['low', 'high'] })
    cbOk(made, 'create')
    const id = made.body.battle.id
    const r = await rpc('cb_bots', { p_battle: id, p_player: cbA })
    cbOk(r, 'bots')
    const b = r.body.battle
    const paid = (b.payouts ?? []).reduce((a, p) => a + p, 0)
    must(b.status === 'running' && b.seats[1]?.bot === true && b.results?.length === 2 && b.results.every((row) => row.length === 2), 'battle started with results')
    must(b.winners?.length >= 1 && paid > 0 && paid <= b.pot + 1e-9, 'winners and payouts')
    must(!JSON.stringify(r.body).includes(cbA) && !JSON.stringify(r.body).includes('bot_'), 'player ids leaked')
    must((await rpc('cb_result', { p_battle: id, p_player: cbA })).body?.state === 'running', 'result while running')
    return { id, pot: b.pot }
  })

  const tag = Math.random().toString(36).slice(2, 8)
  const email = `selftest.${tag}@example.com`
  const password = `Pw-${tag}-${Date.now()}`
  const username = `test_${tag}`
  const made = await step('create account', async () => {
    const r = await createAccount({ email, password, username, wallet: { balance: 1234, xp: 5 } })
    must(r.status === 200, `${r.status} ${r.error}`)
    return { id: !!r.id, rid: r.id }
  })
  const id = made?.rid
  if (made) delete made.rid
  let token = null
  if (id) {
    await step('sign in', async () => {
      const r = await auth('/token?grant_type=password', { method: 'POST', body: { email, password } })
      must(r.ok && r.body?.access_token, `status ${r.status} ${r.body?.error_code || r.body?.msg || ''}`)
      token = r.body.access_token
      return { expires_in: r.body.expires_in }
    })
  }
  if (token) {
    await step('my_profile', async () => {
      const r = await rpc('my_profile', {}, { token })
      must(r.ok && r.body?.username === username && r.body?.wallet?.balance === 1234, `status ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`)
      return { rev: r.body.rev }
    })
    await step('save_wallet', async () => {
      const r = await rpc('save_wallet', { p_wallet: { balance: 1300, xp: 9 }, p_rev: 0 }, { token })
      must(r.ok && r.body?.ok && r.body.rev === 1, `status ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`)
      const again = await rpc('save_wallet', { p_wallet: { balance: 1 }, p_rev: 0 }, { token })
      must(again.body?.error === 'conflict', 'stale save was not refused')
      return { rev: r.body.rev }
    })
    await step('crash_bet as user', async () => {
      const r = await rpc('crash_bet', { p_player: null, p_name: 'x', p_bet: 1, p_auto: 1.5 }, { token })
      must(r.ok && (r.body?.ok || r.body?.error === 'closed'), `status ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`)
      return r.body
    })
    await step('admin function refused for users', async () => {
      const r = await rpc('admin_create_profile', { p_id: id, p_username: 'nope_nope' }, { token })
      must(!r.ok, `status ${r.status}`)
      return { status: r.status }
    })
  }
  if (id) {
    await step('delete account', async () => {
      const r = await deleteUser(id)
      must(r.ok, `status ${r.status}`)
      const gone = await rpc('username_available', { p_username: username })
      must(gone.body === true, 'profile still there')
      return { status: r.status }
    })
  }
  return res.status(200).json({ ok: steps.every((s) => s.ok), steps })
}
