const express = require("express")
const router = express.Router()
const User = require('../../models/User');
const bcrypt = require('bcryptjs');
const Transaction = require('../../models/Transaction'); // Adjust path as needed
const { createObjectCsvStringifier } = require('csv-writer');
const { pipeline, Transform } = require('stream');
const mongoose = require('mongoose');
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
    if (!name || !email || !phone) {
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
            generatedPass: pass,
            company: newUser.company,
            role: newUser.role, // Include role in the response
        };

        res.status(201).json({ message: 'User created successfully', user: userDetails });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal server error' });
    }
});


//filter api
router.get('/filter', async (req, res) => {
    try {
        const filter = {};
        Object.keys(req.query).forEach(key => {
            if (key === 'page' || key === 'limit') return;
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
            if (key === 'isValidated') {
                filter['status'] = req.query.isValidated === 'true'
                    ? { $in: ['valid', 'validated'] }
                    : { $nin: ['valid', 'validated'] };
                return;
            }
            if (['currency_amount', 'discount_percentage', 'o2o'].includes(key) && !isNaN(req.query[key])) {
                filter[key] = Number(req.query[key]);
            } else if (key === 'Approval' && (req.query[key] === 'true' || req.query[key] === 'false')) {
                filter[key] = req.query[key] === 'true';
            } else if (typeof req.query[key] === 'string') {
                filter[key] = { $regex: req.query[key], $options: 'i' };
            } else {
                filter[key] = req.query[key];
            }
        });

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const transactions = await Transaction.find(filter)
            .skip(skip)
            .limit(limit)
            .sort({ tran_date: -1 });

        const totalCount = await Transaction.countDocuments(filter);
        const salesFilter = { ...filter, status: 'VALID' };
        const totalSellCount = await Transaction.countDocuments(salesFilter);

        const totalAmountResult = await Transaction.aggregate([
            { $match: filter },
            { $group: { _id: null, totalAmount: { $sum: '$currency_amount' } } }
        ]);

        const totalSalesAmountResult = await Transaction.aggregate([
            { $match: salesFilter },
            { $group: { _id: null, totalSalesAmount: { $sum: '$currency_amount' } } }
        ]);

        const totalAmount = totalAmountResult.length > 0 ? totalAmountResult[0].totalAmount : 0;
        const totalSalesAmount = totalSalesAmountResult.length > 0 ? totalSalesAmountResult[0].totalSalesAmount : 0;

        let dailySales = [];
        if (req.query.startDate) {
            try {
                // Parse startDate
                const startDate = new Date(req.query.startDate);

                if (!req.query.endDate) {
                    // For a single day query, get the date string in YYYY-MM-DD format
                    const dateString = startDate.toISOString().split('T')[0];

                    // Use a $regex to match the date portion of tran_date
                    const dateFilter = {
                        tran_date: { $regex: `^${dateString}` }
                    };

                    console.log('Date Filter:', dateFilter);

                    // Get total for that specific day
                    const dailyTotal = await Transaction.aggregate([
                        { $match: dateFilter },
                        {
                            $group: {
                                _id: null,
                                totalSalesCount: { $sum: 1 },
                                totalSalesAmount: { $sum: '$currency_amount' }
                            }
                        }
                    ]);

                    console.log('Single Day Results:', dailyTotal);

                    // Format the response for a single day
                    if (dailyTotal.length > 0) {
                        dailySales = {
                            date: dateString,
                            salesCount: dailyTotal[0].totalSalesCount,
                            salesAmount: dailyTotal[0].totalSalesAmount
                        };
                    } else {
                        dailySales = {
                            date: dateString,
                            salesCount: 0,
                            salesAmount: 0
                        };
                    }
                } else {
                    // If both startDate and endDate are provided
                    const endDate = new Date(req.query.endDate);

                    // Calculate the date difference in days
                    const dateDifference = Math.floor((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;

                    // Get date strings in YYYY-MM-DD format
                    const startDateString = startDate.toISOString().split('T')[0];
                    const endDateString = endDate.toISOString().split('T')[0];

                    // Check if the date range is 366 days or more
                    if (dateDifference >= 366) {
                        // Group by month for large date ranges
                        const monthlySalesResult = await Transaction.aggregate([
                            {
                                $addFields: {
                                    dateOnly: {
                                        $substr: ['$tran_date', 0, 10] // Extract YYYY-MM-DD part
                                    }
                                }
                            },
                            {
                                $match: {
                                    dateOnly: {
                                        $gte: startDateString,
                                        $lte: endDateString
                                    }
                                }
                            },
                            {
                                $addFields: {
                                    yearMonth: {
                                        $substr: ['$dateOnly', 0, 7] // Extract YYYY-MM part
                                    }
                                }
                            },
                            {
                                $group: {
                                    _id: '$yearMonth',
                                    monthlySalesCount: { $sum: 1 },
                                    monthlySalesAmount: { $sum: '$currency_amount' }
                                }
                            },
                            { $sort: { '_id': 1 } }
                        ]);

                        console.log('Monthly Aggregation Results:', monthlySalesResult);

                        // Generate all months between startDate and endDate (inclusive)
                        const monthArray = [];
                        let currentMonth = new Date(startDateString);

                        // Add one month to the end date for proper comparison
                        const endMonthPlusOne = new Date(endDateString);
                        endMonthPlusOne.setMonth(endMonthPlusOne.getMonth() + 1);

                        while (currentMonth < endMonthPlusOne) {
                            const yearMonth = currentMonth.toISOString().substring(0, 7); // YYYY-MM format
                            monthArray.push(yearMonth);

                            // Move to the next month
                            currentMonth.setMonth(currentMonth.getMonth() + 1);
                        }

                        // Map aggregation results to a dictionary for easy lookup
                        const salesMap = new Map();
                        monthlySalesResult.forEach(entry => {
                            salesMap.set(entry._id, {
                                monthlySalesCount: entry.monthlySalesCount,
                                monthlySalesAmount: entry.monthlySalesAmount
                            });
                        });

                        // Merge with monthArray to include all months
                        dailySales = monthArray.map(monthStr => {
                            return {
                                _id: monthStr,
                                salesCount: salesMap.has(monthStr) ? salesMap.get(monthStr).monthlySalesCount : 0,
                                salesAmount: salesMap.has(monthStr) ? salesMap.get(monthStr).monthlySalesAmount : 0,
                                periodType: 'month'
                            };
                        });
                    } else {
                        // Regular daily aggregation for smaller date ranges
                        const dailySalesResult = await Transaction.aggregate([
                            {
                                $addFields: {
                                    dateOnly: {
                                        $substr: ['$tran_date', 0, 10] // Extract YYYY-MM-DD part
                                    }
                                }
                            },
                            {
                                $match: {
                                    dateOnly: {
                                        $gte: startDateString,
                                        $lte: endDateString
                                    }
                                }
                            },
                            {
                                $group: {
                                    _id: '$dateOnly',
                                    dailySalesCount: { $sum: 1 },
                                    dailySalesAmount: { $sum: '$currency_amount' }
                                }
                            },
                            { $sort: { '_id': 1 } }
                        ]);

                        console.log('Daily Aggregation Results:', dailySalesResult);

                        // Generate all dates between startDate and endDate (inclusive)
                        const dateArray = [];
                        let currentDate = new Date(startDateString);

                        // Make sure to include the end date by adding one day to it for the comparison
                        const endDatePlusOne = new Date(endDateString);
                        endDatePlusOne.setDate(endDatePlusOne.getDate() + 1);

                        while (currentDate < endDatePlusOne) {
                            const dateStr = currentDate.toISOString().split('T')[0];
                            dateArray.push(dateStr);
                            currentDate.setDate(currentDate.getDate() + 1);
                        }

                        // Map aggregation results to a dictionary for easy lookup
                        const salesMap = new Map();
                        dailySalesResult.forEach(entry => {
                            salesMap.set(entry._id, {
                                dailySalesCount: entry.dailySalesCount,
                                dailySalesAmount: entry.dailySalesAmount
                            });
                        });

                        // Merge with dateArray to include all dates
                        dailySales = dateArray.map(dateStr => {
                            return {
                                _id: dateStr,
                                salesCount: salesMap.has(dateStr) ? salesMap.get(dateStr).dailySalesCount : 0,
                                salesAmount: salesMap.has(dateStr) ? salesMap.get(dateStr).dailySalesAmount : 0,
                                periodType: 'day'
                            };
                        });
                    }
                }
            } catch (err) {
                console.error('Error calculating daily sales:', err);
                res.status(500).json({ success: false, message: 'Server error', error: err.message });
            }
        }

        res.json({
            success: true,
            totalCount,
            totalSellCount,
            totalAmount,
            totalSalesAmount,
            currentPage: page,
            totalPages: Math.ceil(totalCount / limit),
            dailySales: dailySales,
            transactions: transactions,

        });
    } catch (err) {
        console.error('Error filtering transactions:', err);
        res.status(500).json({ success: false, message: 'Server error', error: err.message });
    }
});






// This API will stream data from MongoDB to CSV
router.get('/export-csv', async (req, res) => {
    try {
        // Set headers for CSV download
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=transactions.csv');

        // Get the first document to determine headers
        const sampleDoc = await Transaction.findOne({});
        if (!sampleDoc) {
            return res.status(404).send('No data found');
        }

        // Create headers from the document schema
        const headers = Object.keys(sampleDoc.toObject()).map(key => {
            return { id: key, title: key };
        });

        // Create CSV stringifier
        const csvStringifier = createObjectCsvStringifier({
            header: headers
        });

        // Write headers to response
        res.write(csvStringifier.getHeaderString());

        // Batch size for pagination
        const batchSize = 1000;
        let lastId = null;
        let hasMoreData = true;

        // Process data in batches using pagination with _id
        while (hasMoreData) {
            // Create query for pagination (using _id for efficient pagination)
            const query = lastId ? { _id: { $gt: lastId } } : {};

            // Get batch of documents
            const batch = await Transaction.find(query)
                .sort({ _id: 1 })
                .limit(batchSize)
                .lean();

            // If batch is empty, we've processed all documents
            if (batch.length === 0) {
                hasMoreData = false;
                continue;
            }

            // Update lastId for next iteration
            lastId = batch[batch.length - 1]._id;

            // Convert special MongoDB types (like ObjectId) to strings
            const processedBatch = batch.map(doc => {
                const processedDoc = {};

                // Process each field
                for (const [key, value] of Object.entries(doc)) {
                    if (value instanceof mongoose.Types.ObjectId) {
                        processedDoc[key] = value.toString();
                    } else if (value instanceof Date) {
                        processedDoc[key] = value.toISOString();
                    } else if (typeof value === 'object' && value !== null) {
                        processedDoc[key] = JSON.stringify(value);
                    } else {
                        processedDoc[key] = value;
                    }
                }

                return processedDoc;
            });

            // Write batch to CSV and stream to response
            res.write(csvStringifier.stringifyRecords(processedBatch));
        }

        // End response stream
        res.end();
    } catch (error) {
        console.error('Export error:', error);
        // If headers are already sent, we can't send an error status
        if (!res.headersSent) {
            res.status(500).send(`Export failed: ${error.message}`);
        } else {
            res.end(`\nExport failed: ${error.message}`);
        }
    }
});



module.exports = router;