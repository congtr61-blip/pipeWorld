const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, message: 'Method not allowed.' });
  }

  const { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: serviceKey } = process.env;
  if (!url || !serviceKey) {
    return res.status(503).json({ ok: false, message: 'Case publishing is not configured.' });
  }

  try {
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false }
    });
    const { data, error } = await supabase
      .from('project_cases')
      .select('id,title_en,title_zh,location_en,location_zh,category_en,category_zh,summary_en,summary_zh,details_en,details_zh,cover_url,published_at,created_at')
      .eq('status', 'published')
      .order('published_at', { ascending: false });

    if (error) throw error;
    return res.status(200).json({ ok: true, cases: data });
  } catch (error) {
    console.error('Published case read error:', error);
    return res.status(500).json({ ok: false, message: 'Unable to load case studies.' });
  }
};
