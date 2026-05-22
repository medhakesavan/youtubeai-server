import Lead from '../models/Lead.mjs';

export const getLeads = async (req, res) => {
  try {
    const { status, channelId, search } = req.query;
    const query = { userId: req.user.id };

    if (status) query.status = status;
    if (channelId) query.channelId = channelId;
    if (search) {
      query.$or = [
        { authorName: { $regex: search, $options: 'i' } },
        { whatsappNumber: { $regex: search, $options: 'i' } },
        { originalComment: { $regex: search, $options: 'i' } }
      ];
    }

    const leads = await Lead.find(query).sort({ createdAt: -1 }).limit(200);
    res.json(leads);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const exportLeads = async (req, res) => {
  try {
    const leads = await Lead.find({ userId: req.user.id }).sort({ createdAt: -1 });
    if (leads.length === 0) return res.status(404).send('No leads to export');

    const fields = ['authorName', 'whatsappNumber', 'status', 'isHidden', 'whatsappSent', 'videoId', 'channelId', 'createdAt'];
    const csvRows = [fields.join(',')];

    for (const lead of leads) {
      const row = fields.map(field => {
        const val = lead[field];
        if (val instanceof Date) return val.toISOString();
        if (typeof val === 'string') return `"${val.replace(/"/g, '""')}"`;
        return val;
      });
      csvRows.push(row.join(','));
    }

    res.header('Content-Type', 'text/csv');
    res.attachment('leads.csv');
    res.send(csvRows.join('\n'));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
