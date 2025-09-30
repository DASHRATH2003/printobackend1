import mongoose from 'mongoose';

// Order Schema
const orderSchema = new mongoose.Schema({
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },
  customerName: { type: String, required: true },
  customerEmail: { type: String, required: false },
  customerPhone: { type: String, required: false },
  customerAddress: { type: String, required: false },
  customerCity: { type: String, required: false },
  customerPincode: { type: String, required: false },
  orderId: { type: String, required: true, unique: true },
  paymentId: { type: String, required: true },
  paymentDate: { type: Date, default: Date.now },
  items: [
    {
      name: { type: String, required: true },
      quantity: { type: Number, required: true },
      price: { type: Number, required: true }
    }
  ],
  total: { type: Number, required: true },
  status: {
    type: String,
    enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled'],
    default: 'pending'
  },
  createdAt: { type: Date, default: Date.now }
});

const Order = mongoose.model('Order', orderSchema);

export default Order;
