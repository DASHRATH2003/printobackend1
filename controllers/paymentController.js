import Razorpay from 'razorpay';
import crypto from 'crypto';
import Order from '../models/Order.js';

// Initialize Razorpay
let razorpay = null;

// Function to initialize Razorpay (called lazily)
function initializeRazorpay() {
  if (razorpay) return razorpay; // Already initialized
  
  console.log('🔍 Environment check:');
  console.log('- NODE_ENV:', process.env.NODE_ENV);
  console.log('- RAZORPAY_KEY_ID:', process.env.RAZORPAY_KEY_ID ? `${process.env.RAZORPAY_KEY_ID.substring(0, 10)}...` : 'undefined');
  console.log('- RAZORPAY_KEY_SECRET:', process.env.RAZORPAY_KEY_SECRET ? `${process.env.RAZORPAY_KEY_SECRET.substring(0, 5)}...` : 'undefined');

  if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET && !process.env.RAZORPAY_KEY_SECRET.includes('placeholder')) {
    try {
      razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET,
      });
      console.log('✅ Razorpay initialized successfully');
      return razorpay;
    } catch (error) {
      console.error('❌ Razorpay initialization failed:', error.message);
      return null;
    }
  } else {
    console.warn('⚠️ Razorpay credentials not configured properly. Payment endpoints will return errors.');
    console.warn('- Key ID present:', !!process.env.RAZORPAY_KEY_ID);
    console.warn('- Key Secret present:', !!process.env.RAZORPAY_KEY_SECRET);
    console.warn('- Contains placeholder:', process.env.RAZORPAY_KEY_SECRET?.includes('placeholder'));
    return null;
  }
}

// Create Razorpay Order
const createPaymentOrder = async (req, res) => {
  try {
    console.log('🚀 Creating Razorpay payment order...');
    console.log('📦 Request body:', req.body);
    
    // Initialize Razorpay if not already done
    const razorpayInstance = initializeRazorpay();
    if (!razorpayInstance) {
      return res.status(500).json({
        success: false,
        message: 'Payment service not configured. Please contact administrator.'
      });
    }
    
    const { amount, currency = 'INR', customerInfo, items } = req.body;
    
    // Enhanced validation
    if (!amount || !customerInfo || !items) {
      return res.status(400).json({
        success: false,
        message: 'Amount, customer info, and items are required'
      });
    }

    // Validate amount (must be positive number)
    if (typeof amount !== 'number' || amount <= 0 || amount > 500000) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be a positive number between 1 and 500000'
      });
    }

    // Validate currency
    if (!['INR', 'USD'].includes(currency)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid currency. Only INR and USD are supported'
      });
    }

    // Validate customer info
    const requiredFields = ['name', 'email', 'phone'];
    for (const field of requiredFields) {
      if (!customerInfo[field] || typeof customerInfo[field] !== 'string' || customerInfo[field].trim().length === 0) {
        return res.status(400).json({
          success: false,
          message: `Customer ${field} is required and must be a non-empty string`
        });
      }
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(customerInfo.email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format'
      });
    }

    // Validate phone format (Indian format)
    const phoneRegex = /^[6-9]\d{9}$/;
    if (!phoneRegex.test(customerInfo.phone.replace(/[^\d]/g, ''))) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number format'
      });
    }

    // Validate items
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Items must be a non-empty array'
      });
    }

    // Validate each item
    for (const item of items) {
      if (!item.id || !item.name || typeof item.price !== 'number' || typeof item.quantity !== 'number') {
        return res.status(400).json({
          success: false,
          message: 'Each item must have id, name, price (number), and quantity (number)'
        });
      }
      if (item.price <= 0 || item.quantity <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Item price and quantity must be positive numbers'
        });
      }
    }

    // Calculate and verify total amount
    const calculatedTotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    if (Math.abs(calculatedTotal - amount) > 0.01) {
      return res.status(400).json({
        success: false,
        message: 'Amount mismatch. Calculated total does not match provided amount'
      });
    }
    
    // Create Razorpay order
    const options = {
      amount: Math.round(amount * 100), // Amount in paise and round
      currency: currency,
      receipt: `receipt_${Date.now()}`.substring(0, 40), // Limit receipt length
      notes: {
        customerName: customerInfo.name.substring(0, 50),
        customerEmail: customerInfo.email.substring(0, 50),
        customerPhone: customerInfo.phone.substring(0, 15),
        itemCount: items.length,
        totalAmount: amount
      }
    };
    
    console.log('🔧 Razorpay order options:', options);
    
    const order = await razorpayInstance.orders.create(options);
    
    console.log('✅ Razorpay order created successfully:', order);
    
    // Log order creation for audit
    console.log(`Payment order created: ${order.id} for amount: ${amount} by ${customerInfo.email}`);
    
    res.status(200).json({
      success: true,
      order: {
        id: order.id,
        amount: order.amount,
        currency: order.currency,
        receipt: order.receipt
      },
      key: process.env.RAZORPAY_KEY_ID
    });
    
  } catch (error) {
    console.error('❌ Error creating Razorpay order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create payment order',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// Verify Razorpay Payment
const verifyPayment = async (req, res) => {
  try {
    console.log('🔍 Verifying Razorpay payment...');
    console.log('📦 Request body:', req.body);
    
    // Initialize Razorpay if not already done
    const razorpayInstance = initializeRazorpay();
    if (!razorpayInstance) {
      return res.status(500).json({
        success: false,
        message: 'Payment service not configured. Please contact administrator.'
      });
    }
    
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      customerInfo,
      items,
      amount
    } = req.body;
    
    // Enhanced validation for required fields
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: 'Missing payment verification data'
      });
    }

    // Validate Razorpay ID formats
    const orderIdRegex = /^order_[A-Za-z0-9]{14}$/;
    const paymentIdRegex = /^pay_[A-Za-z0-9]{14}$/;
    
    if (!orderIdRegex.test(razorpay_order_id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Razorpay order ID format'
      });
    }

    if (!paymentIdRegex.test(razorpay_payment_id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Razorpay payment ID format'
      });
    }

    // Validate signature format (should be hex string)
    const signatureRegex = /^[a-f0-9]{64}$/;
    if (!signatureRegex.test(razorpay_signature)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid signature format'
      });
    }

    // Validate other required data
    if (!customerInfo || !items || !amount) {
      return res.status(400).json({
        success: false,
        message: 'Missing customer info, items, or amount'
      });
    }

    // Validate amount
    if (typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid amount'
      });
    }

    // Check for duplicate payment processing
    const existingOrder = await Order.findOne({ paymentId: razorpay_payment_id });
    if (existingOrder) {
      return res.status(409).json({
        success: false,
        message: 'Payment already processed',
        orderId: existingOrder.orderId
      });
    }
    
    // Create signature for verification
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest('hex');
    
    console.log('🔐 Expected signature:', expectedSignature);
    console.log('🔐 Received signature:', razorpay_signature);
    
    // Secure signature comparison to prevent timing attacks
    const isAuthentic = crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'hex'),
      Buffer.from(razorpay_signature, 'hex')
    );
    
    if (!isAuthentic) {
      console.error('❌ Payment signature verification failed');
      return res.status(400).json({
        success: false,
        message: 'Payment verification failed'
      });
    }
    
    console.log('✅ Payment signature verified successfully');

    // Fetch payment details from Razorpay for additional verification
    try {
      const paymentDetails = await razorpayInstance.payments.fetch(razorpay_payment_id);
      
      // Verify payment status
      if (paymentDetails.status !== 'captured') {
        return res.status(400).json({
          success: false,
          message: `Payment not captured. Status: ${paymentDetails.status}`
        });
      }

      // Verify amount matches
      const razorpayAmount = paymentDetails.amount / 100; // Convert from paise
      if (Math.abs(razorpayAmount - amount) > 0.01) {
        return res.status(400).json({
          success: false,
          message: 'Amount mismatch with Razorpay records'
        });
      }

      console.log('✅ Payment details verified with Razorpay');
    } catch (razorpayError) {
      console.error('Error fetching payment from Razorpay:', razorpayError);
      // Continue with order creation as signature is already verified
    }
    
    // Generate unique order ID
    const orderId = `ORD${Date.now()}${razorpay_payment_id.slice(-4).toUpperCase()}`;
    
    // Sanitize and validate customer data
    const sanitizedCustomerInfo = {
      name: customerInfo.name?.substring(0, 100) || 'Anonymous User',
      email: customerInfo.email?.substring(0, 100) || '',
      phone: customerInfo.phone?.replace(/[^\d]/g, '').substring(0, 15) || '',
      address: customerInfo.address?.substring(0, 500) || '',
      city: customerInfo.city?.substring(0, 100) || '',
      pincode: customerInfo.pincode?.replace(/[^\d]/g, '').substring(0, 10) || ''
    };
    
    // Create order in database with sanitized data
    const orderData = {
      orderId: orderId,
      paymentId: razorpay_payment_id,
      razorpayOrderId: razorpay_order_id,
      total: amount,
      items: items.map(item => ({
        id: item.id,
        name: item.name?.substring(0, 200),
        price: Number(item.price),
        quantity: Number(item.quantity),
        image: item.image?.substring(0, 500)
      })),
      customerName: sanitizedCustomerInfo.name,
      customerEmail: sanitizedCustomerInfo.email,
      customerPhone: sanitizedCustomerInfo.phone,
      customerAddress: sanitizedCustomerInfo.address,
      customerCity: sanitizedCustomerInfo.city,
      customerPincode: sanitizedCustomerInfo.pincode,
      paymentStatus: 'completed',
      paymentDate: new Date()
    };
    
    console.log('💾 Saving order to database:', orderData);
    
    const newOrder = new Order(orderData);
    const savedOrder = await newOrder.save();
    
    console.log('✅ Order saved successfully:', savedOrder._id);
    
    // Log successful order creation for audit
    console.log(`Order created: ${orderId} for payment ${razorpay_payment_id} by ${sanitizedCustomerInfo.email}`);
    
    res.status(200).json({
      success: true,
      message: 'Payment verified and order created successfully',
      order: {
        id: savedOrder._id,
        orderId: orderId,
        paymentId: razorpay_payment_id,
        amount: amount,
        status: 'completed'
      }
    });
    
  } catch (error) {
    console.error('❌ Error verifying payment:', error);
    res.status(500).json({
      success: false,
      message: 'Payment verification failed',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// Get Payment Status
const getPaymentStatus = async (req, res) => {
  try {
    const { paymentId } = req.params;
    
    console.log('🔍 Checking payment status for:', paymentId);
    
    // Initialize Razorpay if not already done
    const razorpayInstance = initializeRazorpay();
    if (!razorpayInstance) {
      return res.status(500).json({
        success: false,
        message: 'Payment service not configured. Please contact administrator.'
      });
    }
    
    const payment = await razorpayInstance.payments.fetch(paymentId);
    
    console.log('📊 Payment status:', payment.status);
    
    res.status(200).json({
      success: true,
      payment: {
        id: payment.id,
        status: payment.status,
        amount: payment.amount,
        currency: payment.currency,
        method: payment.method,
        created_at: payment.created_at
      }
    });
    
  } catch (error) {
    console.error('❌ Error fetching payment status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment status',
      error: error.message
    });
  }
};

export {
  createPaymentOrder,
  verifyPayment,
  getPaymentStatus
};