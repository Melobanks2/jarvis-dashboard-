/**
 * /api/marketing.js — Marketing Intelligence metrics for dashboard
 * Vercel serverless function
 * Returns: current month metrics, trends vs last week, source performance, county performance
 */

const { createClient } = require("@supabase/supabase-js");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_KEY
  );

  try {
    const now       = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const weekStart  = new Date(Date.now() - 7 * 86400000).toISOString();
    const prevWeekStart = new Date(Date.now() - 14 * 86400000).toISOString();

    // Fetch current month + last week + prev week in parallel
    const [
      { data: monthData },
      { data: weekData },
      { data: prevData },
    ] = await Promise.all([
      sb.from("marketing_metrics").select("*").gte("created_at", monthStart),
      sb.from("marketing_metrics").select("*").gte("created_at", weekStart),
      sb.from("marketing_metrics").select("*").gte("created_at", prevWeekStart).lt("created_at", weekStart),
    ]);

    function calcMetrics(data) {
      const rows = data || [];
      const totalLeads     = rows.length;
      const totalSpend     = rows.reduce((s, r) => s + (r.cost || 0), 0);
      const contacted      = rows.filter(r => r.contacted).length;
      const qualified      = rows.filter(r => r.qualified).length;
      const appointments   = rows.filter(r => r.appointment_set).length;
      const dealsClosed    = rows.filter(r => r.deal_closed).length;
      const revenue        = rows.reduce((s, r) => s + (r.revenue || 0), 0);
      const roi            = totalSpend > 0 ? Math.round(((revenue - totalSpend) / totalSpend) * 100) : 0;
      const costPerContact = contacted > 0 ? +(totalSpend / contacted).toFixed(2) : 0;
      const costPerQual    = qualified > 0 ? +(totalSpend / qualified).toFixed(2) : 0;
      const costPerAppt    = appointments > 0 ? +(totalSpend / appointments).toFixed(2) : 0;
      const costPerDeal    = dealsClosed > 0 ? +(totalSpend / dealsClosed).toFixed(2) : 0;
      return { totalLeads, totalSpend, contacted, qualified, appointments, dealsClosed, revenue, roi, costPerContact, costPerQual, costPerAppt, costPerDeal };
    }

    const month = calcMetrics(monthData);
    const week  = calcMetrics(weekData);
    const prev  = calcMetrics(prevData);

    // Trend arrows: compare week vs prev week
    function trend(cur, prv) {
      if (prv === 0 && cur === 0) return "flat";
      if (prv === 0) return "up";
      const pct = ((cur - prv) / prv) * 100;
      if (pct > 5) return "up";
      if (pct < -5) return "down";
      return "flat";
    }

    const trends = {
      totalLeads:     trend(week.totalLeads,   prev.totalLeads),
      totalSpend:     trend(week.totalSpend,   prev.totalSpend),
      contacted:      trend(week.contacted,    prev.contacted),
      qualified:      trend(week.qualified,    prev.qualified),
      appointments:   trend(week.appointments, prev.appointments),
      dealsClosed:    trend(week.dealsClosed,  prev.dealsClosed),
      revenue:        trend(week.revenue,      prev.revenue),
      roi:            trend(week.roi,          prev.roi),
      costPerContact: trend(prev.costPerContact, week.costPerContact), // inverted: lower is better
      costPerQual:    trend(prev.costPerQual,    week.costPerQual),
      costPerAppt:    trend(prev.costPerAppt,    week.costPerAppt),
      costPerDeal:    trend(prev.costPerDeal,    week.costPerDeal),
    };

    // Source performance (all time)
    const sourceMap = {};
    for (const r of monthData || []) {
      const s = r.source || "Unknown";
      if (!sourceMap[s]) sourceMap[s] = { leads: 0, contacted: 0, qualified: 0, appointments: 0, deals: 0, spend: 0, revenue: 0 };
      sourceMap[s].leads++;
      if (r.contacted)       sourceMap[s].contacted++;
      if (r.qualified)       sourceMap[s].qualified++;
      if (r.appointment_set) sourceMap[s].appointments++;
      if (r.deal_closed)     sourceMap[s].deals++;
      sourceMap[s].spend   += r.cost || 0;
      sourceMap[s].revenue += r.revenue || 0;
    }

    const sources = Object.entries(sourceMap)
      .map(([name, d]) => ({
        name,
        leads:       d.leads,
        contacted:   d.contacted,
        qualified:   d.qualified,
        appointments: d.appointments,
        deals:       d.deals,
        spend:       +d.spend.toFixed(2),
        revenue:     +d.revenue.toFixed(2),
        roi:         d.spend > 0 ? Math.round(((d.revenue - d.spend) / d.spend) * 100) : 0,
        qualRate:    d.leads > 0 ? Math.round(d.qualified / d.leads * 100) : 0,
        contactRate: d.leads > 0 ? Math.round(d.contacted / d.leads * 100) : 0,
        dealRate:    d.leads > 0 ? +(d.deals / d.leads * 100).toFixed(1) : 0,
        costPerDeal: d.deals > 0 ? Math.round(d.spend / d.deals) : null,
      }))
      .sort((a, b) => b.leads - a.leads);

    // County performance
    const countyMap = {};
    for (const r of monthData || []) {
      const c = r.county || "Unknown";
      if (!countyMap[c]) countyMap[c] = { leads: 0, contacted: 0, qualified: 0, appointments: 0, deals: 0, spend: 0, revenue: 0 };
      countyMap[c].leads++;
      if (r.contacted)       countyMap[c].contacted++;
      if (r.qualified)       countyMap[c].qualified++;
      if (r.appointment_set) countyMap[c].appointments++;
      if (r.deal_closed)     countyMap[c].deals++;
      countyMap[c].spend   += r.cost || 0;
      countyMap[c].revenue += r.revenue || 0;
    }

    const counties = Object.entries(countyMap)
      .map(([name, d]) => ({
        name,
        leads:       d.leads,
        contacted:   d.contacted,
        qualified:   d.qualified,
        appointments: d.appointments,
        deals:       d.deals,
        spend:       +d.spend.toFixed(2),
        revenue:     +d.revenue.toFixed(2),
        roi:         d.spend > 0 ? Math.round(((d.revenue - d.spend) / d.spend) * 100) : 0,
        qualRate:    d.leads > 0 ? Math.round(d.qualified / d.leads * 100) : 0,
        contactRate: d.leads > 0 ? Math.round(d.contacted / d.leads * 100) : 0,
      }))
      .sort((a, b) => b.leads - a.leads);

    // Age bucket performance (Coupon Club optimizer data)
    const ageBuckets = [
      { label: "< 6h",    rows: (monthData || []).filter(r => r.lead_age_hours != null && r.lead_age_hours < 6) },
      { label: "6–24h",   rows: (monthData || []).filter(r => r.lead_age_hours >= 6 && r.lead_age_hours < 24) },
      { label: "24–48h",  rows: (monthData || []).filter(r => r.lead_age_hours >= 24 && r.lead_age_hours < 48) },
      { label: "> 48h",   rows: (monthData || []).filter(r => r.lead_age_hours >= 48) },
      { label: "Unknown", rows: (monthData || []).filter(r => r.lead_age_hours == null) },
    ].map(b => ({
      label:      b.label,
      leads:      b.rows.length,
      qualified:  b.rows.filter(r => r.qualified).length,
      deals:      b.rows.filter(r => r.deal_closed).length,
      qualRate:   b.rows.length > 0 ? Math.round(b.rows.filter(r => r.qualified).length / b.rows.length * 100) : 0,
    })).filter(b => b.leads > 0);

    res.json({ month, week, prev, trends, sources, counties, ageBuckets, updatedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
