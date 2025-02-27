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

    console.log(req.body);

    if (!phone || !password) {
        return res.status(400).json({ message: 'Phone and password are required' });
    }

    try {
        // Find user by phone
        const user = await User.findOne({ phone }).select('+password');
        const hashPass = user.password;
        // console.log(hashPass)
        //  console.log(password)

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Compare passwords
        const isPasswordValid = await bcrypt.compare(password, hashPass);
        // console.log(isPasswordValid)

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
    const { name, email, phone, company, password, role } = req.body;

    // console.log(password);
    // Validate required fields
    if (!name || !email || !phone || !password) {
        return res.status(400).json({ message: 'All fields are required' });
    }

    try {
        // Check if user already exists by email or phone
        const existingUser = await User.findOne({ $or: [{ email }, { phone }] });

        if (existingUser) {
            return res.status(400).json({ message: 'User with this email or phone already exists' });
        }





        // Hash the generated password
        //const hashedPassword = await bcrypt.hash(password, 10); // 10 is the salt rounds

        // console.log("hash", hashedPassword);

        // Create a new user with the hashed password and role
        const newUser = new User({
            name,
            email,
            phone,
            company,
            password: password,
            role: role || 'user', // Use provided role or default to 'user'
        });

        await newUser.save();

        // Return user details (excluding password)
        const userDetails = {
            _id: newUser._id,
            name: newUser.name,
            email: newUser.email,
            phone: newUser.phone,
            generatedPass: password,
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
        // Build the query object dynamically from request query parameters
        const query = {};

        // Process date range filters
        let dateQuery = {};
        if (req.query.startDate && req.query.endDate) {
            // Convert dates to ISO format for consistent comparison
            const startDate = new Date(req.query.startDate);
            const endDate = new Date(req.query.endDate);
            endDate.setHours(23, 59, 59, 999); // Set to end of day

            dateQuery = {
                Timestamp: {
                    $gte: startDate.toISOString().split('T')[0],
                    $lte: endDate.toISOString().split('T')[0]
                }
            };
        } else if (req.query.startDate) {
            // If only startDate is provided, filter for that specific date
            const startDate = new Date(req.query.startDate);
            dateQuery = {
                Timestamp: startDate.toISOString().split('T')[0]
            };
        }

        // Add date query to main query
        Object.assign(query, dateQuery);

        // Remove special filter parameters from the query object
        const { startDate, endDate, page, limit, ...filters } = req.query;

        // Process all other filters
        Object.keys(filters).forEach(key => {
            // Handle nested fields in Product object
            if (key.startsWith('Product.')) {
                const productField = key.split('Product.')[1];
                query[`Product.${productField}`] = filters[key];
            } else {
                // Handle regular fields
                // For numeric fields, convert string to number
                if (['currency_amount', 'store_amount'].includes(key)) {
                    query[key] = Number(filters[key]);
                } else {
                    // Use regex for partial string matching for string fields (case-insensitive)
                    if (typeof filters[key] === 'string') {
                        query[key] = { $regex: filters[key], $options: 'i' };
                    } else {
                        query[key] = filters[key];
                    }
                }
            }
        });

        // Get sales statistics for the date range/single date
        // We'll get this before applying pagination
        const salesStats = await Transaction.aggregate([
            { $match: { ...query, status: "VALID" } }, // Only count valid transactions
            {
                $group: {
                    _id: null,
                    totalSalesCount: { $sum: 1 },
                    totalSalesAmount: { $sum: "$currency_amount" } // Using currency_amount instead of store_amount
                }
            }
        ]).exec();

        const salesData = salesStats.length > 0 ? {
            totalSalesCount: salesStats[0].totalSalesCount,
            totalSalesAmount: salesStats[0].totalSalesAmount
        } : {
            totalSalesCount: 0,
            totalSalesAmount: 0
        };

        // Pagination
        const pageNum = parseInt(page) || 1;
        const pageSize = parseInt(limit) || 10;
        const skip = (pageNum - 1) * pageSize;

        // Execute query with pagination
        const transactions = await Transaction.find(query)
            .skip(skip)
            .limit(pageSize)
            .exec();

        // Get total count for pagination info
        const total = await Transaction.countDocuments(query);

        // Get date information for the response
        let dateInfo = {};
        if (req.query.startDate && req.query.endDate) {
            dateInfo = {
                dateRange: true,
                startDate: req.query.startDate,
                endDate: req.query.endDate
            };
        } else if (req.query.startDate) {
            dateInfo = {
                dateRange: false,
                date: req.query.startDate
            };
        }

        return res.status(200).json({
            success: true,
            count: transactions.length,
            total,
            page: pageNum,
            totalPages: Math.ceil(total / pageSize),
            dateInfo,
            salesData,
            data: transactions
        });

    } catch (error) {
        console.error('Error filtering transactions:', error);
        return res.status(500).json({
            success: false,
            error: 'Server Error',
            message: error.message
        });
    }
});

// Add a dedicated endpoint just for sales statistics
router.get('/sales-stats', async (req, res) => {
    try {
        // Build date query
        let dateQuery = {};

        if (req.query.startDate && req.query.endDate) {
            // Convert dates to ISO format for consistent comparison
            const startDate = new Date(req.query.startDate);
            const endDate = new Date(req.query.endDate);
            endDate.setHours(23, 59, 59, 999); // Set to end of day

            dateQuery = {
                Timestamp: {
                    $gte: startDate.toISOString().split('T')[0],
                    $lte: endDate.toISOString().split('T')[0]
                }
            };
        } else if (req.query.startDate) {
            // If only startDate is provided, filter for that specific date
            const startDate = new Date(req.query.startDate);
            dateQuery = {
                Timestamp: startDate.toISOString().split('T')[0]
            };
        }

        // Add status filter for valid transactions
        const query = { ...dateQuery, status: "VALID" };

        // Get overall sales statistics
        const overallStats = await Transaction.aggregate([
            { $match: query },
            {
                $group: {
                    _id: null,
                    totalSalesCount: { $sum: 1 },
                    totalSalesAmount: { $sum: "$currency_amount" } // Using currency_amount instead of store_amount
                }
            }
        ]).exec();

        // Get daily breakdown of sales
        const dailyStats = await Transaction.aggregate([
            { $match: query },
            {
                $group: {
                    _id: "$Timestamp",
                    salesCount: { $sum: 1 },
                    salesAmount: { $sum: "$currency_amount" } // Using currency_amount instead of store_amount
                }
            },
            { $sort: { _id: 1 } } // Sort by date ascending
        ]).exec();

        // Get date information for the response
        let dateInfo = {};
        if (req.query.startDate && req.query.endDate) {
            dateInfo = {
                dateRange: true,
                startDate: req.query.startDate,
                endDate: req.query.endDate
            };
        } else if (req.query.startDate) {
            dateInfo = {
                dateRange: false,
                date: req.query.startDate
            };
        }

        return res.status(200).json({
            success: true,
            dateInfo,
            overallStats: overallStats.length > 0 ? {
                totalSalesCount: overallStats[0].totalSalesCount,
                totalSalesAmount: overallStats[0].totalSalesAmount
            } : {
                totalSalesCount: 0,
                totalSalesAmount: 0
            },
            dailyStats: dailyStats.map(day => ({
                date: day._id,
                salesCount: day.salesCount,
                salesAmount: day.salesAmount
            }))
        });

    } catch (error) {
        console.error('Error getting sales stats:', error);
        return res.status(500).json({
            success: false,
            error: 'Server Error',
            message: error.message
        });
    }
});


// Get combined top products data (both by amount and count)
router.get('/top-products', async (req, res) => {
    try {
        // Build date query
        let dateQuery = {};

        if (req.query.startDate && req.query.endDate) {
            const startDate = new Date(req.query.startDate);
            const endDate = new Date(req.query.endDate);
            endDate.setHours(23, 59, 59, 999);

            dateQuery = {
                Timestamp: {
                    $gte: startDate.toISOString().split('T')[0],
                    $lte: endDate.toISOString().split('T')[0]
                }
            };
        } else if (req.query.startDate) {
            const startDate = new Date(req.query.startDate);
            dateQuery = {
                Timestamp: startDate.toISOString().split('T')[0]
            };
        }

        // Add status filter for valid transactions
        const query = { ...dateQuery, status: "VALID" };

        // Get all product sales data
        const productSales = await Transaction.aggregate([
            { $match: query },
            {
                $group: {
                    _id: "$ProductName",
                    salesCount: { $sum: 1 },
                    salesAmount: { $sum: "$currency_amount" }
                }
            }
        ]).exec();

        // Sort by amount and count
        const byAmount = [...productSales].sort((a, b) => b.salesAmount - a.salesAmount);
        const byCount = [...productSales].sort((a, b) => b.salesCount - a.salesCount);

        // Calculate overall totals
        const overallTotal = {
            salesCount: productSales.reduce((sum, product) => sum + product.salesCount, 0),
            salesAmount: productSales.reduce((sum, product) => sum + product.salesAmount, 0)
        };

        // Get date information for the response
        let dateInfo = {};
        if (req.query.startDate && req.query.endDate) {
            dateInfo = {
                dateRange: true,
                startDate: req.query.startDate,
                endDate: req.query.endDate
            };
        } else if (req.query.startDate) {
            dateInfo = {
                dateRange: false,
                date: req.query.startDate
            };
        }

        // Format data specifically for charts
        const chartData = {
            // For pie/donut charts showing sales distribution by amount
            pieChartAmount: byAmount.slice(0, 5).map(product => ({
                name: product._id,
                value: product.salesAmount,
                percentage: ((product.salesAmount / overallTotal.salesAmount) * 100).toFixed(2)
            })),

            // For pie/donut charts showing sales distribution by count
            pieChartCount: byCount.slice(0, 5).map(product => ({
                name: product._id,
                value: product.salesCount,
                percentage: ((product.salesCount / overallTotal.salesCount) * 100).toFixed(2)
            })),

            // For bar charts comparing top products
            barChart: byAmount.slice(0, 10).map(product => ({
                name: product._id,
                amount: product.salesAmount,
                count: product.salesCount
            })),

            // For data tables with complete information
            tableData: productSales.map(product => ({
                productName: product._id,
                salesCount: product.salesCount,
                salesAmount: product.salesAmount,
                percentageByAmount: ((product.salesAmount / overallTotal.salesAmount) * 100).toFixed(2),
                percentageByCount: ((product.salesCount / overallTotal.salesCount) * 100).toFixed(2)
            }))
        };

        return res.status(200).json({
            success: true,
            dateInfo,
            overallTotal,
            chartData,
            // Preserve original data structure for backward compatibility
            byAmount: {
                top3Products: byAmount.slice(0, 3).map(product => ({
                    productName: product._id,
                    salesCount: product.salesCount,
                    salesAmount: product.salesAmount,
                    percentageOfTotal: ((product.salesAmount / overallTotal.salesAmount) * 100).toFixed(2)
                })),
                otherProducts: {
                    count: byAmount.length - 3,
                    salesAmount: byAmount.slice(3).reduce((sum, product) => sum + product.salesAmount, 0),
                    percentageOfTotal: ((byAmount.slice(3).reduce((sum, product) => sum + product.salesAmount, 0) / overallTotal.salesAmount) * 100).toFixed(2)
                }
            },
            byCount: {
                top3Products: byCount.slice(0, 3).map(product => ({
                    productName: product._id,
                    salesCount: product.salesCount,
                    salesAmount: product.salesAmount,
                    percentageOfTotal: ((product.salesCount / overallTotal.salesCount) * 100).toFixed(2)
                })),
                otherProducts: {
                    count: byCount.length - 3,
                    salesCount: byCount.slice(3).reduce((sum, product) => sum + product.salesCount, 0),
                    percentageOfTotal: ((byCount.slice(3).reduce((sum, product) => sum + product.salesCount, 0) / overallTotal.salesCount) * 100).toFixed(2)
                }
            }
        });

    } catch (error) {
        console.error('Error getting top products:', error);
        return res.status(500).json({
            success: false,
            error: 'Server Error',
            message: error.message
        });
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