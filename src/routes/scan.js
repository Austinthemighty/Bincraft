import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { query } from '../db/index.js';

const router = Router();

router.use(requireAuth);

// Scanner page
router.get('/', (req, res) => {
  res.render('scan/index', { title: 'Scan Card', activePage: 'scan' });
});

// Direct scan URL from QR code
router.get('/card/:uid', async (req, res) => {
  try {
    const cardResult = await query(
      `SELECT c.*, i.name AS item_name, i.part_number, i.current_stock, i.reorder_point
       FROM cards c
       JOIN items i ON c.item_id = i.id
       WHERE c.card_uid = $1`,
      [req.params.uid]
    );
    const card = cardResult.rows[0];

    if (!card) {
      res.flash('error', 'Card not found');
      return res.redirect('/scan');
    }

    // Record the scan
    await query(
      `INSERT INTO scan_history (card_id, scanned_by, status_at_scan)
       VALUES ($1, $2, $3)`,
      [card.id, req.authUser.id, card.status]
    );

    // Update card status to 'scanned'
    if (card.status === 'full') {
      await query(
        `UPDATE cards SET status = 'empty', updated_at = NOW() WHERE id = $1`,
        [card.id]
      );
    }

    res.flash('success', `Scanned card for ${card.item_name}`);
    res.redirect(`/cards/${card.id}`);
  } catch (err) {
    console.error('Scan error:', err);
    res.flash('error', 'Failed to process scan');
    res.redirect('/scan');
  }
});

export default router;
