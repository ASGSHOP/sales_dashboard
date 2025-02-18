const express = require("express")
const router = express.Router()
const User = require('../../models/User');
const bcrypt = require('bcryptjs');
const Transaction = require('../../models/Transaction'); // Adjust path as needed

/**
 * @route GET /api/transactions/filter
 * @desc Filter transactions by any field in query params
 * @access Private (add your auth middleware as needed)
 */


router.post('/auth', async (req, res) => {
    const { phone, password } = req.body;

    if (!phone || !password) {
        return res.status(400).json({ message: 'Phone and password are required' });
    }

    try {
        // Find user by phone
        const user = await User.findOne({ phone });

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Compare passwords
        const isPasswordValid = await bcrypt.compare(password, user.password);

        if (!isPasswordValid) {
            return res.status(401).json({ message: 'Invalid password' });
        }

        // Return user details (excluding password)
        const userDetails = { phone: user.phone, _id: user._id };
        res.status(200).json({ message: 'Authentication successful', user: userDetails });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error' });
    }
});




router.post('/create-user', async (req, res) => {
    const { name, email, phone, company, role } = req.body;

    // Validate required fields
    if (!name || !email || !phone || !company) {
        return res.status(400).json({ message: 'All fields are required' });
    }

    try {
        // Check if user already exists by email or phone
        const existingUser = await User.findOne({ $or: [{ email }, { phone }] });

        if (existingUser) {
            return res.status(400).json({ message: 'User with this email or phone already exists' });
        }

        // Function to generate a random string
        function generateRandomString(length = 5) {
            const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
            let result = '';

            for (let i = 0; i < length; i++) {
                const randomIndex = Math.floor(Math.random() * characters.length);
                result += characters[randomIndex];
            }

            return result;
        }

        // Generate a random password
        const pass = generateRandomString();

        // Hash the generated password
        const hashedPassword = await bcrypt.hash(pass, 10); // 10 is the salt rounds

        // Create a new user with the hashed password and role
        const newUser = new User({
            name,
            email,
            phone,
            company,
            password: hashedPassword,
            role: role || 'user', // Use provided role or default to 'user'
        });

        await newUser.save();

        // Return user details (excluding password)
        const userDetails = {
            _id: newUser._id,
            name: newUser.name,
            email: newUser.email,
            phone: newUser.phone,
            company: newUser.company,
            role: newUser.role, // Include role in the response
        };

        res.status(201).json({ message: 'User created successfully', user: userDetails });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error' });
    }
});


router.get('/filter', async (req, res) => {
    try {
        // Start with an empty filter object
        const filter = {};

        // Dynamically build filter from query parameters
        Object.keys(req.query).forEach(key => {
            // Skip pagination params if present
            if (key === 'page' || key === 'limit') return;

            // Handle date range with startDate and endDate query params
            if (key === 'startDate') {
                filter['tran_date'] = filter['tran_date'] || {};
                filter['tran_date']['$gte'] = req.query.startDate;
                return;
            }

            if (key === 'endDate') {
                filter['tran_date'] = filter['tran_date'] || {};
                filter['tran_date']['$lte'] = req.query.endDate;
                return;
            }

            // Handle status validation filter
            if (key === 'isValidated') {
                if (req.query.isValidated === 'true') {
                    filter['status'] = { $in: ['valid', 'validated'] };
                } else if (req.query.isValidated === 'false') {
                    filter['status'] = { $nin: ['valid', 'validated'] };
                }
                return;
            }

            // Handle numeric fields
            if (['currency_amount', 'discount_percentage', 'o2o'].includes(key) && !isNaN(req.query[key])) {
                filter[key] = Number(req.query[key]);
            }
            // Handle boolean
            else if (key === 'Approval' && (req.query[key] === 'true' || req.query[key] === 'false')) {
                filter[key] = req.query[key] === 'true';
            }
            // Handle string fields with partial matching
            else if (typeof req.query[key] === 'string') {
                filter[key] = { $regex: req.query[key], $options: 'i' };
            }
            // For other fields, use exact match
            else {
                filter[key] = req.query[key];
            }
        });

        // Parse pagination parameters
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        // Execute query with pagination
        const transactions = await Transaction.find(filter)
            .skip(skip)
            .limit(limit)
            .sort({ tran_date: -1 });

        // Get total count of matching documents
        const totalCount = await Transaction.countDocuments(filter);

        // Create a filter for successful sales (approved transactions)
        const salesFilter = { ...filter, status: 'VALID' };

        // Get total sell count (approved transactions only)
        const totalSellCount = await Transaction.countDocuments(salesFilter);

        // Calculate total amount based on currency_amount
        const totalAmountResult = await Transaction.aggregate([
            { $match: filter },
            {
                $group: {
                    _id: null,
                    totalAmount: { $sum: '$currency_amount' }
                }
            }
        ]);

        // Calculate total sales amount (approved transactions only) based on currency_amount
        const totalSalesAmountResult = await Transaction.aggregate([
            { $match: salesFilter },
            {
                $group: {
                    _id: null,
                    totalSalesAmount: { $sum: '$currency_amount' }
                }
            }
        ]);

        const totalAmount = totalAmountResult.length > 0 ? totalAmountResult[0].totalAmount : 0;
        const totalSalesAmount = totalSalesAmountResult.length > 0 ? totalSalesAmountResult[0].totalSalesAmount : 0;

        res.json({
            success: true,
            totalCount,
            totalSellCount,
            totalAmount,
            totalSalesAmount,
            currentPage: page,
            totalPages: Math.ceil(totalCount / limit),
            transactions: transactions
        });

    } catch (err) {
        console.error('Error filtering transactions:', err);
        res.status(500).json({ success: false, message: 'Server error', error: err.message });
    }
});



// router.post('/filter', async (req, res) => {
//     try {
//         // Get filter criteria and pagination from request body
//         const { filter = {}, page = 1, limit = 10 } = req.body;
//         const skip = (page - 1) * limit;

//         // Process the filter to handle regex for string searches
//         Object.keys(filter).forEach(key => {
//             // Handle numeric fields
//             if (['currency_amount', 'store_amount', 'discount_percentage', 'o2o'].includes(key) && !isNaN(filter[key])) {
//                 filter[key] = Number(filter[key]);
//             }
//             // Handle boolean
//             else if (key === 'Approval' && (filter[key] === true || filter[key] === false)) {
//                 // No transformation needed for boolean
//             }
//             // Handle date range
//             else if (key === 'tran_date' && filter[key].start && filter[key].end) {
//                 filter[key] = {
//                     $gte: filter[key].start,
//                     $lte: filter[key].end
//                 };
//             }
//             // Handle string fields with partial matching
//             else if (typeof filter[key] === 'string') {
//                 filter[key] = { $regex: filter[key], $options: 'i' };
//             }
//         });

//         // Execute query with pagination
//         const transactions = await Transaction.find(filter)
//             .skip(skip)
//             .limit(limit)
//             .sort({ tran_date: -1 });

//         // Get total count of matching documents
//         const totalCount = await Transaction.countDocuments(filter);

//         // Calculate total amount
//         const totalAmountResult = await Transaction.aggregate([
//             { $match: filter },
//             {
//                 $group: {
//                     _id: null,
//                     totalAmount: { $sum: '$store_amount' },
//                     totalCurrencyAmount: { $sum: '$currency_amount' }
//                 }
//             }
//         ]);

//         const totalAmount = totalAmountResult.length > 0 ? totalAmountResult[0].totalAmount : 0;
//         const totalCurrencyAmount = totalAmountResult.length > 0 ? totalAmountResult[0].totalCurrencyAmount : 0;

//         res.json({
//             success: true,
//             totalCount,
//             totalAmount,
//             totalCurrencyAmount,
//             currentPage: page,
//             totalPages: Math.ceil(totalCount / limit),
//             transactions
//         });

//     } catch (err) {
//         console.error('Error filtering transactions:', err);
//         res.status(500).json({ success: false, message: 'Server error', error: err.message });
//     }
// });


module.exports = router;