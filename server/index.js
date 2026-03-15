require('dotenv').config();
const express = require('express');
const cors = require('cors');

const repurposeRoutes = require('./routes/repurpose');
const checkoutRoutes = require('./routes/checkout');
const webhookRoutes = require('./routes/webhook');
const meRoutes = require('./routes/me');

const app = express();
const PORT = process.env.PORT || 3001;

// Stripe webhook needs raw body — mount before express.json()
app.use('/api/webhook', express.raw({ type: 'application/json' }), webhookRoutes);

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json());

app.use('/api/repurpose', repurposeRoutes);
app.use('/api/checkout', checkoutRoutes);
app.use('/api/me', meRoutes);

app.get('/api/health', (_, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`PRISM server running on port ${PORT}`);
});
