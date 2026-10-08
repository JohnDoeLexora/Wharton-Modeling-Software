"""Independent V3 Monte Carlo reference simulator — Laura Gao case (Wharton GHSIC 2026-27).
Team analysis tool, NOT investment advice.

Design
- Annual steps, t=0 is BOY 2027. Rates simulated 2027..2043 (17 BOY points) so the 2033-2042 reserve run-off is path-based.
- Counter-based RNG: one numpy Philox stream per shock family, keyed by (seed, stream id). Every mix compared within a
  world uses the SAME shock arrays (common random numbers). Perturbed worlds re-use the same underlying normals too.
- Fixed income priced per spec: R = carry - D*dy + 0.5*C*dy^2 (- credit loss). Target-maturity bonds priced from cash flows.
"""
import numpy as np
from params import BASE, REGIMES, U, SECTORS, JUMPS, FALLBACK, BASKETS, T_CARVE, T_COMM, PAYMENT, N_PAY, load_calib
import json, os

NY = 16            # annual return steps 2027..2042
NE = 6             # equity/credit steps needed (2027..2032)
STREAMS = dict(rates=1, rates_u=2, mkt=3, chi=4, sector=5, fx=6, idio=7, idio_chi=8, jumps=9, geo=10, credit=11, default=12, regime=13)
REG_NAMES = list(REGIMES)

def _gen(seed, stream):
    return np.random.Generator(np.random.Philox(key=[seed, STREAMS[stream]]))

class Shocks:
    """All primitive random numbers, generated once per (seed, N)."""
    def __init__(self, n, seed=20261007, n_names=None):
        self.n, self.seed = n, seed
        K = n_names
        g = _gen(seed, "rates"); self.ex = g.standard_normal((n, NY))
        g = _gen(seed, "rates_u"); self.e5 = g.standard_normal((n, NY)); self.e10 = g.standard_normal((n, NY))
        g = _gen(seed, "mkt"); self.em = g.standard_normal((n, NE))
        g = _gen(seed, "chi"); self.chi_u = g.random((n, NE))          # uniform -> chi2 via inverse later (df may vary)
        g = _gen(seed, "sector"); self.F = g.standard_normal((n, NE, len(SECTORS)))
        g = _gen(seed, "fx"); self.fx = g.standard_normal((n, NE))
        g = _gen(seed, "idio"); self.eps = g.standard_normal((n, NE, K)).astype(np.float32)
        g = _gen(seed, "idio_chi"); self.eps_chi = g.chisquare(5, (n, NE, K)).astype(np.float32)  # chi2(5) for idio t5
        g = _gen(seed, "jumps"); self.jd = g.random((n, NE, K)).astype(np.float32); self.ju = g.random((n, NE, K)).astype(np.float32)
        g = _gen(seed, "geo"); self.geo = g.random((n, NE))
        g = _gen(seed, "credit"); self.eig = g.standard_normal((n, NE + 1)); self.espx = g.standard_normal((n, NE + 1))
        g = _gen(seed, "default"); self.dspx = g.random((n, NE + 1))
        g = _gen(seed, "regime"); self.reg_u = g.random(n)
        # market/sector chi2(df=5) from 5 squared normals (counter-based, reproducible)
        g = _gen(seed, "chi"); self.mchi_parts = g.standard_normal((n, NE, 10)) ** 2   # chi2(df) = sum of first df squares (CRN across df)

def build_universe():
    c = load_calib()["names"]
    sc = json.load(open(os.path.join(os.path.dirname(__file__), "data", "sector_corr.json")))
    names = list(U)
    beta, idio, rho, info = [], [], [], {}
    for t in names:
        if t in FALLBACK or t not in c or c[t]["n"] < 24:
            b, s = FALLBACK.get(t, (1.3, 0.5)); src = "assumption (short history)"
        else:
            b, s = c[t]["beta_blume"], c[t]["idio_ann"]; src = f"Yahoo 5y monthly, n={c[t]['n']}, Blume-shrunk"
        sec = U[t]["sector"]
        r = (sc.get(sec, {}).get("avg_resid_corr") or 0.35)
        if U[t]["jc"] == "etf": r = 0.80      # an ETF's residual vs SPY is mostly its sector/country factor
        beta.append(b); idio.append(s); rho.append(r); info[t] = dict(beta=b, idio=s, sector_rho=r, src=src, **U[t])
    return names, np.array(beta), np.array(idio), np.array(rho), info

NAMES, BETA, IDIO, RHO, NAME_INFO = build_universe()
NIDX = {t: i for i, t in enumerate(NAMES)}

# ---------------- bond math ----------------
def par_dur_conv(y, n):
    """Modified duration & convexity of an n-year annual-pay par bond at yield y (vectorized)."""
    y = np.maximum(y, 1e-4)
    def price(yy, c):
        k = np.arange(1, n + 1)[None, :]
        v = (1 + yy[..., None]) ** (-k)
        return (c[..., None] * v).sum(-1) + v[..., -1]
    h = 1e-4; c = y
    p0, pu, pd = price(y, c), price(y + h, c), price(y - h, c)
    D = -(pu - pd) / (2 * h * p0); C = (pu + pd - 2 * p0) / (h * h * p0)
    return D, C

def bond_price(c, M, y):
    """Clean-ish price per 1 face of annual coupon c, remaining maturity M (years, may be fractional), flat yield y."""
    y = np.maximum(y, -0.009)
    M = np.asarray(M, float)
    out = np.zeros(np.broadcast(c, M, y).shape)
    mmax = int(np.ceil(np.max(M))) + 1
    for j in range(mmax):
        tj = M - j
        out = out + np.where(tj > 1e-9, c * (1 + y) ** (-np.maximum(tj, 0)), 0.0)
    return out + np.where(M > 1e-9, (1 + y) ** (-np.maximum(M, 0)), 1.0)

def curve_y(M, r, y5, y10, ls):
    """3-point curve, linear interpolation in maturity; M scalar or array broadcastable."""
    M = np.asarray(M, float)
    a = np.where(M <= 0.25, r, np.where(M <= 5, r + (y5 - r) * (M - 0.25) / 4.75,
          np.where(M <= 10, y5 + (y10 - y5) * (M - 5) / 5, y10 + ls * np.minimum((M - 10) / 10, 1.0))))
    return a

# ---------------- world ----------------
def regime_index(sh, p, force=None):
    if force is not None:
        return np.full(sh.n, REG_NAMES.index(force))
    probs = np.array([p["regime_probs"][k] for k in REG_NAMES]); cp = np.cumsum(probs / probs.sum())
    return np.searchsorted(cp, sh.reg_u)

def build_world(sh, overrides=None, force_regime=None):
    p = dict(BASE); p.update(overrides or {})
    n = sh.n
    ri = regime_index(sh, p, force_regime)
    # mean curve paths per regime (17 BOY points)
    ms = np.zeros((len(REG_NAMES), NY + 1)); m5 = np.zeros_like(ms); m10 = np.zeros_like(ms)
    for k, rg in enumerate(REG_NAMES):
        R = REGIMES[rg]
        for t in range(NY):
            ms[k, t + 1] = ms[k, t] + R["ds"].get(t, 0); m5[k, t + 1] = m5[k, t] + R["d5"].get(t, 0); m10[k, t + 1] = m10[k, t] + R["d10"].get(t, 0)
    ms += p["r0"]; m5 += p["y5_0"]; m10 += p["y10_0"]
    x = np.zeros((n, NY + 1)); u5 = np.zeros_like(x); u10 = np.zeros_like(x)
    e10c = p["rho_u"] * sh.e5 + np.sqrt(1 - p["rho_u"] ** 2) * sh.e10
    for t in range(NY):
        x[:, t + 1] = p["phi_x"] * x[:, t] + p["s_x"] * sh.ex[:, t]
        u5[:, t + 1] = p["phi_u"] * u5[:, t] + p["s_u5"] * sh.e5[:, t]
        u10[:, t + 1] = p["phi_u"] * u10[:, t] + p["s_u10"] * e10c[:, t]
    r = np.maximum(ms[ri] + x, p["r_floor"])
    y5 = np.maximum(m5[ri] + p["b5"] * x + u5, 0.0005)
    y10 = np.maximum(m10[ri] + p["b10"] * x + u10, 0.001)
    ls = p["long_spread"]
    fee_t = 0.0005
    # --- treasury sleeves (constant maturity, spec formula) ---
    bill = 0.5 * (r[:, :-1] + r[:, 1:]) - fee_t                 # rolled 3m bills: earn average yield over the year
    D5, C5 = par_dur_conv(y5[:, :-1], 5); D10, C10 = par_dur_conv(y10[:, :-1], 10)
    d5 = np.diff(y5, axis=1); d10 = np.diff(y10, axis=1)
    t5 = y5[:, :-1] - D5 * d5 + 0.5 * C5 * d5 ** 2 - fee_t
    t10 = y10[:, :-1] - D10 * d10 + 0.5 * C10 * d10 ** 2 - fee_t
    DL, CL = 16.0, 330.0
    tlong = (y10[:, :-1] + ls) - DL * d10 + 0.5 * CL * d10 ** 2 - fee_t
    # --- target-maturity Treasury maturing BOY 2033 (exact cash-flow pricing; HTM -> par) ---
    c33 = curve_y(6.0, r[:, 0], y5[:, 0], y10[:, 0], ls)
    P = np.zeros((n, NE + 1))
    for t in range(NE + 1):
        M = 6 - t
        P[:, t] = bond_price(c33, M, curve_y(M, r[:, t], y5[:, t], y10[:, t], ls)) if M > 0 else 1.0
    tgt33 = (P[:, 1:] + c33[:, None]) / P[:, :-1] - 1 - fee_t
    # --- equity: market (multivariate-t with sectors & FX), regime overlays, Taiwan geo jumps ---
    df = p["df"]
    scale = np.sqrt((df - 2) / sh.mchi_parts[:, :, :int(df)].sum(-1))                          # shared chi2 -> multivariate t (tail dependence)
    corr = np.array([REGIMES[k]["corr"] for k in REG_NAMES])[ri] if p["rate_equity_corr"] is None else np.full(n, p["rate_equity_corr"])
    zm = corr[:, None] * sh.ex[:, :NE] + np.sqrt(1 - corr[:, None] ** 2) * sh.em
    ov = np.zeros((len(REG_NAMES), NE))
    for k, rg in enumerate(REG_NAMES):
        for t, v in REGIMES[rg]["eq"].items(): ov[k, t] = v
    geo = sh.geo < p["p_geo"]
    if p["forced_geo_year"] is not None: geo[:, p["forced_geo_year"]] = True
    gh = p["geo_hit"]
    comp = p["p_geo"] if p["jump_comp"] else 0.0
    mu_m = p["r0"] + p["erp"]
    Rm = mu_m + ov[ri] + p["sig_m"] * zm * scale + gh["MKT"] * geo - comp * gh["MKT"]
    if p["forced_crash"] is not None:
        yy, shock = p["forced_crash"]; Rm[:, yy] += shock
    Rm = np.maximum(Rm, -0.95)
    core = Rm - p["core_fee"]
    rf = bill[:, :NE] + fee_t
    # --- names: one-factor + sector factor + FX + idio (t5) + jumps ---
    K = len(NAMES)
    idio = IDIO * p["idio_mult"]
    rho = np.clip(RHO * p["sector_rho_mult"], 0, 0.95)
    tw = np.array([U[t]["tw"] for t in NAMES], float)
    fxv = p["twd_vol"]
    idio_ex = np.sqrt(np.maximum(idio ** 2 - (tw * fxv) ** 2, 0.05 ** 2))
    sec_idx = np.array([SECTORS.index(U[t]["sector"]) for t in NAMES])
    Fs = sh.F[:, :, sec_idx] * scale[:, :, None]                 # (n,NE,K)
    FX = (sh.fx * scale)[:, :, None]
    eps_t = sh.eps * np.sqrt(3.0 / sh.eps_chi)  # standardized t5 (var 1)
    jc = [U[t]["jc"] for t in NAMES]
    pdn = np.array([JUMPS[j][0] for j in jc]); jdn = np.array([JUMPS[j][1] for j in jc])
    pup = np.array([JUMPS[j][2] for j in jc]); jup = np.array([JUMPS[j][3] for j in jc])
    jumps = (sh.jd < pdn) * jdn + (sh.ju < pup) * jup
    jcomp = (pdn * jdn + pup * jup) if p["jump_comp"] else 0.0
    # Taiwan geo exposure per name
    gexp = np.zeros(K)
    for i, t in enumerate(NAMES):
        if tw[i] >= 1: gexp[i] = gh["TW"]
        elif t == "AAXJ": gexp[i] = gh["AAXJ"]
        elif U[t]["sector"] == "SEMI_AI" or t in ("AAPL",): gexp[i] = gh["SEMI"]
        elif U[t]["sector"] == "CHINA_AI": gexp[i] = gh["CHINA"]
        elif t == "EWJ": gexp[i] = gh["JAPAN"]
    gexp_idio = gexp - BETA * gh["MKT"]                           # incremental beyond beta*market hit
    fee = np.array([U[t]["fee"] for t in NAMES])
    names_r = (rf[:, :, None] + BETA[None, None, :] * (Rm - rf)[:, :, None]
               + np.sqrt(rho)[None, None, :] * idio_ex[None, None, :] * Fs
               + (tw * fxv)[None, None, :] * FX
               + np.sqrt(1 - rho)[None, None, :] * idio_ex[None, None, :] * eps_t
               + jumps - jcomp
               + geo[:, :, None] * gexp_idio[None, None, :] - (comp * gexp_idio if p["jump_comp"] else 0.0)
               - fee[None, None, :] + p["alpha_sat"])
    names_r = np.maximum(names_r, -0.99).astype(np.float32)
    # --- IG credit sleeve (VCIT-like), spread widens in equity drawdowns ---
    s = np.zeros((n, NE + 1)); s[:, 0] = p["ig_s0"]
    surpr = Rm - (mu_m + ov[ri])
    for t in range(NE):
        s[:, t + 1] = np.maximum(s[:, t] + p["ig_kappa"] * (p["ig_sbar"] - s[:, t]) - p["ig_beta"] * surpr[:, t]
                                 - 0.05 * np.minimum(Rm[:, t] + 0.20, 0) + p["ig_sig"] * sh.eig[:, t], 0.004)
    dyc = d5[:, :NE] + np.diff(s, axis=1)
    exr = Rm - rf
    pd_ig = p["ig_pd"] + p["ig_pd_stress"] * np.clip((-exr - 0.15) / 0.25, 0, 1)
    ig = (y5[:, :NE] + s[:, :NE]) - p["ig_D"] * dyc + 0.5 * p["ig_C"] * dyc ** 2 - pd_ig * (1 - p["ig_rec"]) - p["ig_fee"]
    # --- SpaceX 5.65% 2033 notes (hypothetical sleeve): issuer credit tied to SPCX equity ---
    spcx = names_r[:, :, NIDX["SPCX"]].astype(float)
    V = np.cumprod(1 + spcx, axis=1); V = np.concatenate([np.ones((n, 1)), V], 1)
    ss = np.zeros((n, NE + 1)); ss[:, 0] = p["spx_s0"]
    esp = rf + BETA[NIDX["SPCX"]] * (mu_m - rf)
    for t in range(NE):
        ss[:, t + 1] = np.maximum(ss[:, t] + p["spx_kappa"] * (p["spx_sbar"] - ss[:, t]) - p["spx_beta"] * (spcx[:, t] - esp[:, t])
                                  + p["spx_sig"] * sh.espx[:, t], 0.004)
    Ps = np.zeros((n, NE + 1)); defaulted = np.zeros((n, NE), bool); spx_ret = np.zeros((n, NE))
    for t in range(NE + 1):
        M = p["spx_mat"] - t
        Ps[:, t] = bond_price(p["spx_coupon"], M, curve_y(M, r[:, t], y5[:, t], y10[:, t], ls) + ss[:, t])
    for t in range(NE):
        dd = 1 - V[:, t] / np.maximum.accumulate(V[:, :t + 1], axis=1)[:, -1]
        pdt = np.where(dd > p["spx_distress_dd"], p["spx_pd_distress"], p["spx_pd"])
        defaulted[:, t] = sh.dspx[:, t] < pdt
        spx_ret[:, t] = np.where(defaulted[:, t], p["spx_rec"] / Ps[:, t] - 1, (Ps[:, t + 1] + p["spx_coupon"]) / Ps[:, t] - 1)
    infl = np.array([p["inflation"][k] for k in REG_NAMES])[ri]
    return dict(p=p, ri=ri, r=r, y5=y5, y10=y10, bill=bill, t5=t5, t10=t10, tlong=tlong, tgt33=tgt33, core=core, Rm=Rm,
                names=names_r, ig=ig, spx=spx_ret, spx_default=defaulted, geo=geo, rf=rf, infl=infl, D5=D5, D10=D10,
                ig_spread=s, spx_spread=ss)

# ---------------- portfolio ----------------
TSY_COMPS = {   # composition of the "Treasury sleeve" (user: 'T-bills' = Treasuries broadly)
    "bills": {"bill": 1.0},
    "5y": {"t5": 1.0},
    "10y": {"t10": 1.0},
    "bills_5y": {"bill": 0.5, "t5": 0.5},
    "5y_10y": {"t5": 0.5, "t10": 0.5},
    "ladder_b5_10": {"bill": 1 / 3, "t5": 1 / 3, "t10": 1 / 3},
    "barbell_D4.5": {"bill": 0.43, "t10": 0.57},       # duration ~4.5 (0.43*0.25+0.57*7.6)
    "target2033": {"tgt33": 1.0},                       # Treasury maturing at the 2033 carve-out (HTM)
    "long20": {"tlong": 1.0},
}

def basket_returns(world, basket, n_names):
    idx = [NIDX[t] for t in BASKETS[basket][:n_names]]
    sub = world["names"][:, :, idx].astype(float)
    rb = sub.mean(-1)
    disp = np.abs(sub - rb[:, :, None]).mean(-1) / (1 + rb)       # within-basket rebalance turnover
    return rb, disp

def expand_weights(mix):
    """mix: dict with 'w' (sleeve->weight) or 'w0'/'w1' (linear glide 2027->2032). Sleeves: core, tsy, ig, spx, sat, + raw instruments."""
    if "w" in mix: return [mix["w"]] * NE
    out = []
    for t in range(NE):
        a = t / (NE - 1); keys = set(mix["w0"]) | set(mix["w1"])
        out.append({k: (1 - a) * mix["w0"].get(k, 0) + a * mix["w1"].get(k, 0) for k in keys})
    return out

def simulate_mix(world, mix):
    p = world["p"]; n = world["core"].shape[0]
    tsy_comp = TSY_COMPS[mix.get("tsy_comp", "bills")]
    tsy_r = sum(wt * world[k][:, :NE] for k, wt in tsy_comp.items())
    inst = {"core": world["core"], "tsy": tsy_r, "ig": world["ig"], "spx": world["spx"],
            "bill": world["bill"][:, :NE], "t5": world["t5"][:, :NE], "t10": world["t10"][:, :NE], "tgt33": world["tgt33"], "tlong": world["tlong"][:, :NE]}
    disp = np.zeros((n, NE))
    if mix.get("basket"):
        rb, disp = basket_returns(world, mix["basket"], mix.get("n_names", 15)); inst["sat"] = rb
    ws = expand_weights(mix)
    tc = p["tc_bps"] / 1e4
    W = np.full(n, 300_000.0); nav = np.ones((n, NE + 1)); Wp = np.zeros((n, NE + 1)); Wp[:, 0] = W
    Rp_all = np.zeros((n, NE))
    for t in range(NE):
        w = ws[t]
        Rp = sum(wt * inst[k][:, t] for k, wt in w.items() if wt)
        Rp = Rp - tc * w.get("sat", 0) * disp[:, t]
        # drift then rebalance to next target
        wn = ws[t + 1] if t + 1 < NE else w
        turn = 0.0
        for k in set(w) | set(wn):
            drifted = w.get(k, 0) * (1 + inst[k][:, t]) / (1 + Rp) if w.get(k, 0) else 0.0
            turn = turn + np.abs(wn.get(k, 0) - drifted)
        Rp = Rp - tc * turn
        Rp_all[:, t] = Rp
        W = W * (1 + Rp)
        if t == 0: W = W + 150_000.0
        nav[:, t + 1] = nav[:, t] * (1 + Rp); Wp[:, t + 1] = W
    w_tsy = np.array([w.get("tsy", 0) for w in ws])
    return dict(W=Wp, nav=nav, Rp=Rp_all, tsy_r=tsy_r, inst=inst, ws=ws)

# ---------------- reserve ----------------
def reserve_analysis(world, W33):
    p = world["p"]; t0 = T_CARVE; ls = p["long_spread"]
    r, y5, y10 = world["r"], world["y5"], world["y10"]
    k = np.arange(N_PAY)
    yk = np.stack([curve_y(kk, r[:, t0], y5[:, t0], y10[:, t0], ls) if kk > 0 else np.zeros(len(W33)) for kk in k], 1)
    dfac = (1 + yk) ** (-k[None, :])
    PV = PAYMENT * dfac.sum(1)
    DL = (PAYMENT * dfac * k[None, :]).sum(1) / PV          # Macaulay duration of liability at 2033
    R_bill = PAYMENT * ((1 + p["bill_reserve_rate"]) ** (-k)).sum()
    # T-bill run-off (reserve sized at conservative 2% flat) along simulated bill path
    A = np.full(len(W33), R_bill); ok_bill = np.ones(len(W33), bool)
    for j in range(N_PAY):
        ok_bill &= A >= PAYMENT - 1e-6; A = A - PAYMENT
        if j < N_PAY - 1: A = A * (1 + world["bill"][:, t0 + j])
    surplus_bill = A
    # Duration-matched constant-maturity Treasuries (bills/5y/10y mix targeting remaining liability duration), sized at PV*(1+buffer)
    A = PV * (1 + p["dur_buffer"]); ok_dur = np.ones(len(W33), bool); Db = 0.25
    for j in range(N_PAY):
        ok_dur &= A >= PAYMENT - 1e-6; A = A - PAYMENT
        if j == N_PAY - 1: break
        t = t0 + j; rem = np.arange(1, N_PAY - j)
        Drem = (rem / (1 + y5[:, t:t+1]) ** rem).sum(1) / (1 / (1 + y5[:, t:t+1]) ** rem).sum(1)  # Macaulay, approx flat y5
        D5 = world["D5"][:, t]; D10 = world["D10"][:, t]
        w5 = np.where(Drem <= D5, (Drem - Db) / (D5 - Db), (D10 - Drem) / (D10 - D5)); w5 = np.clip(w5, 0, 1)
        w10 = np.where(Drem > D5, 1 - w5, 0.0); wb = np.where(Drem <= D5, 1 - w5, 0.0)
        A = A * (1 + wb * world["bill"][:, t] + w5 * world["t5"][:, t] + w10 * world["t10"][:, t])
    surplus_dur = A
    return dict(PV=PV, DL=DL, R_bill=R_bill, ok_bill=ok_bill, ok_dur=ok_dur, surplus_bill=surplus_bill, surplus_dur=surplus_dur)

# ---------------- metrics ----------------
def batch_se(x, fn, nb=20):
    vals = np.array([fn(b) for b in np.array_split(x, nb)]); return float(vals.std(ddof=1) / np.sqrt(nb))

def comm_range(W31, gift, lo_q=0.10, hi_q=0.90, nbins=20):
    """2031 communication: bin trials by BOY-2031 wealth (known then); range = conditional quantiles of 2033 gift.
    Fit on even trials, evaluate coverage out-of-sample on odd trials."""
    tr = np.arange(len(W31)) % 2 == 0; te = ~tr
    edges = np.quantile(W31[tr], np.linspace(0, 1, nbins + 1)); edges[0], edges[-1] = -np.inf, np.inf
    btr = np.clip(np.searchsorted(edges, W31[tr], side="right") - 1, 0, nbins - 1)
    bte = np.clip(np.searchsorted(edges, W31[te], side="right") - 1, 0, nbins - 1)
    lo = np.array([np.quantile(gift[tr][btr == b], lo_q) for b in range(nbins)])
    hi = np.array([np.quantile(gift[tr][btr == b], hi_q) for b in range(nbins)])
    g = gift[te]; L, H = lo[bte], hi[bte]
    cov = float(np.mean((g >= L) & (g <= H))); below = float(np.mean(g < L))
    mid = [nbins // 10, nbins // 2, nbins - 1 - nbins // 10]   # ~p10, p50, p90 of W2031
    centers = [float(np.median(W31[tr][btr == b])) for b in mid]
    return dict(coverage=cov, below_low=below, table=[(centers[i], float(lo[b]), float(hi[b])) for i, b in enumerate(mid)])

def metrics(world, res):
    p = world["p"]; W = res["W"]; W33 = W[:, T_CARVE]; W31 = W[:, T_COMM]; n = len(W33)
    ra = reserve_analysis(world, W33)
    q = lambda a, x: float(np.quantile(a, x))
    m = {}
    for pc in (1, 5, 10, 50, 90, 95): m[f"W33_p{pc}"] = q(W33, pc / 100)
    m["W33_mean"] = float(W33.mean())
    srt = np.sort(W33); m["W33_cvar5"] = float(srt[: max(1, n // 20)].mean())
    m["PV_reserve_p50"] = q(ra["PV"], .5); m["PV_reserve_p5"] = q(ra["PV"], .05); m["PV_reserve_p95"] = q(ra["PV"], .95)
    m["liab_dur_p50"] = q(ra["DL"], .5)
    f_l = W33 >= ra["PV"]; f_n = W33 >= 500_000; f_b = (W33 >= ra["R_bill"]) & ra["ok_bill"]; f_d = (W33 >= ra["PV"] * (1 + p["dur_buffer"])) & ra["ok_dur"]
    for k, f in (("ladder", f_l), ("nominal500", f_n), ("billladder", f_b), ("durmatch", f_d)):
        m[f"P_funded_{k}"] = float(f.mean())
    m["P_funded_ladder_se"] = float(np.sqrt(m["P_funded_ladder"] * (1 - m["P_funded_ladder"]) / n))
    m["durmatch_surplus_p5"] = q(ra["surplus_dur"], .05); m["durmatch_surplus_p50"] = q(ra["surplus_dur"], .5)
    m["P_runoff_fail_bill"] = float(1 - ra["ok_bill"].mean()); m["P_runoff_fail_dur"] = float(1 - ra["ok_dur"].mean())
    fr = W33 / ra["PV"]; m["funded_ratio_p5"] = q(fr, .05); m["funded_ratio_p50"] = q(fr, .5)
    short = np.maximum(ra["PV"] - W33, 0); m["E_shortfall_if_unfunded"] = float(short[short > 0].mean()) if (short > 0).any() else 0.0
    nav = res["nav"]; dd = 1 - nav / np.maximum.accumulate(nav, axis=1); mdd = dd.max(1)
    m["maxDD_p50"] = q(mdd, .5); m["maxDD_p95"] = q(mdd, .95)
    resid = W33 - ra["PV"]; gift = (1 - p["retain_frac"]) * np.maximum(resid, 0)
    for pc in (5, 10, 25, 50, 75, 90): m[f"gift_p{pc}"] = q(gift, pc / 100)
    m["gift_mean"] = float(gift.mean()); m["P_gift_zero"] = float((gift <= 0).mean()); m["P_gift_ge_100k"] = float((gift >= 100_000).mean())
    m["resid_p50"] = q(resid, .5)
    defl = (1 + world["infl"]) ** 7; m["gift_real2026_p50"] = q(gift / defl, .5)
    cr = comm_range(W31, gift)
    m["comm2031_coverage_p10_p90"] = cr["coverage"]; m["comm2031_below_low"] = cr["below_low"]
    for lab, (c, lo, hi) in zip(("lowW31", "midW31", "highW31"), cr["table"]):
        m[f"comm_{lab}_W31"] = c; m[f"comm_{lab}_lo"] = lo; m[f"comm_{lab}_hi"] = hi
    cr2 = comm_range(W31, gift, 0.10, 0.75); m["comm2031_cov_p10_p75"] = cr2["coverage"]
    ex = res["Rp"] - world["rf"]
    sd = ex.std(); dn = np.sqrt((np.minimum(ex, 0) ** 2).mean())
    m["sharpe"] = float(ex.mean() / sd) if sd > 0.005 else float("nan"); m["sortino"] = float(ex.mean() / dn) if dn > 0.002 else float("nan")
    m["ann_ret_p50"] = q((W33 / 1) ** 0 * (res["nav"][:, -1]) ** (1 / 6) - 1, .5)
    tr = res["tsy_r"]
    m["tsy_worst_year_p5"] = q(tr.min(1), .05); m["tsy_P_any_neg_year"] = float((tr < 0).any(1).mean())
    m["tsy_cum_ret_p50"] = q(np.prod(1 + tr, 1) - 1, .5); m["tsy_cum_ret_p5"] = q(np.prod(1 + tr, 1) - 1, .05)
    m["W33_p5_se"] = batch_se(W33, lambda b: np.quantile(b, .05)); m["W33_p50_se"] = batch_se(W33, lambda b: np.quantile(b, .5))
    m["gift_p50_se"] = batch_se(gift, lambda b: np.quantile(b, .5))
    m["n_trials"] = n
    return m, dict(W33=W33, W31=W31, gift=gift, PV=ra["PV"], resid=resid, ra=ra)
