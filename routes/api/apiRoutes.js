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
    const { startDate, endDate, page, ...rest } = req?.query
    console.log(page);
    const matchQuery = {
        Timestamp: {
            $gte: startDate,
            $lte: endDate
        }
    };

    // Iterate over all query parameters
    for (const [key, value] of Object.entries(rest)) {
        // Skip startDate and endDate since they are already handled
        if (key === 'startDate' || key === 'endDate') continue;

        // Dynamically add conditions to the matchQuery
        // Example: If key is "Product.Platform", it will be added as a nested field
        matchQuery[key] = value;
    }
    console.log(matchQuery)

    const response = await Transaction.aggregate([{
        $match: matchQuery
    },

    {
        $facet: {
            totalData: [
                {
                    $group: {
                        _id: null,
                        totalAmount: { $sum: "$currency_amount" },
                        totalCount: { $sum: 1 },
                    }
                },
            ],
            barChartData: [
                {
                    $group: {
                        _id: { $substr: ["$Timestamp", 0, 10] },
                        totalAmount: { $sum: "$currency_amount" },
                        totalCount: { $sum: 1 },
                    },
                },
                {
                    $sort: { _id: 1 }
                }
            ],
            pichart: [
                {
                    $group: {
                        _id: { $substr: ["$Timestamp", 0, 10] },
                        productName: { $first: "$Product.productName" },
                        productId: { $first: "$Product.productId" },
                        amount: { $sum: "$currency_amount" },
                        count: { $sum: 1 }
                    },
                },
                {
                    $sort: {
                        amount: -1
                    }
                },
                {
                    $limit: 2
                },
            ],
            other: [
                {
                    $group: {
                        _id: { $substr: ["$Timestamp", 0, 10] },
                        productName: { $first: "$Product.productName" },
                        productId: { $first: "$Product.productId" },
                        amount: { $sum: "$currency_amount" },
                        count: { $sum: 1 }
                    }
                },
                {
                    $sort: { amount: -1 }
                },
                {
                    $skip: 2
                },
                {
                    $group: {
                        _id: null,
                        productName: { $first: "$other.productName" },
                        productId: { $first: "$Product.productId" },
                        amount: { $sum: "$amount" },
                        count: { $sum: "$count" }
                    }
                },
                {
                    $project: {
                        _id: { $literal: "otherDatas" },
                        productName: { $literal: "Other" },
                        productId: { $literal: "N/A" },
                        amount: 1,
                        count: 1
                    }
                }
            ],
            tranjection: [
                {
                    $group: {
                        _id: null,
                        totalTranjectionAmount: { $sum: "$currency_amount" },
                        totalTranjectionCount: { $sum: 1 },
                        tranjectionData: {
                            $push:
                            {
                                tran_id: "$tran_id",
                                amount: "$currency_amount",
                                productName: "$Product.productName",
                                productId: "$Product.productId",
                                cycle: "$Product.Cycle",
                                platform: "$Product.Platform",
                                email: "$Email",
                                name: "$Name",
                                phone: "$Phone",
                                type: "$gw",
                                date: "$Timestamp",
                                discountAmount: "$discount_amount",
                                storeAmount: "$store_amount",
                                coupon: "$Coupon"
                            }
                        }
                    }
                },
                {
                    $unwind: "$tranjectionData"
                },
                {
                    $skip: 10 * (page - 1), //Calculate Skip Value Write (prev)
                },
                {
                    $limit: 10 //Per page limit Value
                }
            ]
        }
    },
    {
        $project: {
            piChart: { $concatArrays: ["$pichart", "$other"] },
            totalAmount: { $arrayElemAt: ["$totalData.totalAmount", 0] },
            totalCount: { $arrayElemAt: ["$totalData.totalCount", 0] },
            barChartData: 1,
            tranjection: 1,
        }
    }

    ])
    // console.log(response);
    return res.status(200).send(response);
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