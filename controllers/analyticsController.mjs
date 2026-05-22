import mongoose from 'mongoose';
import Comment from '../models/Comment.mjs';
import Lead from '../models/Lead.mjs';

export const getAnalytics = async (req, res) => {
  try {
    const { channelId } = req.query;
    const userIdObj = new mongoose.Types.ObjectId(req.user.id);
    const query = { userId: req.user.id };
    const aggMatch = { userId: userIdObj };
    
    if (channelId) {
      query.channelId = channelId;
      aggMatch.channelId = channelId;
    }

    const totalComments = await Comment.countDocuments(query);
    const toxicDeleted = await Comment.countDocuments({ ...query, status: 'deleted' });
    const positiveLiked = await Comment.countDocuments({ ...query, autoLiked: true });
    const pendingModeration = await Comment.countDocuments({ ...query, status: { $in: ['pending', 'flagged'] } });

    const sentimentCounts = await Comment.aggregate([
      { $match: aggMatch },
      { $group: { _id: '$sentiment', count: { $sum: 1 } } }
    ]);

    const languageCounts = await Comment.aggregate([
      { $match: aggMatch },
      { $group: { _id: '$language', count: { $sum: 1 } } }
    ]);

    const wordCategoryCounts = await Comment.aggregate([
      { $match: aggMatch },
      { $unwind: '$detectedWords' },
      { $group: { _id: '$detectedWords.category', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 }
    ]);

    const recentActivities = await Comment.find(query)
      .sort({ updatedAt: -1 })
      .limit(5);

    const activities = recentActivities.map(c => ({
      ...c.toObject(),
      id: c._id,
      type: c.status === 'deleted' ? 'delete' : (c.autoLiked ? 'like' : 'new_comment')
    }));

    const totalLeads = await Lead.countDocuments(query);

    res.json({
      totalComments,
      toxicDeleted,
      positiveLiked,
      pendingModeration,
      totalLeads,
      categories: sentimentCounts,
      languages: languageCounts,
      topCategories: wordCategoryCounts,
      activities
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
