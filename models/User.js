const mongoose = require('mongoose');
const bcrypt = require('bcryptjs')

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Name is required'],
        trim: true,
        minlength: [2, 'Name must be at least 2 characters long'],
        maxlength: [50, 'Name cannot be more than 50 characters']
    },
    phone: {
        type: String,
        required: [true, 'Phone number is required'],
        trim: true,

    },
    email: {
        type: String,
        required: [true, 'Email is required'],
        unique: true,
        trim: true,
        lowercase: true,

    },
    password: {
        type: String,
        required: [true, 'Password is required'],
        minlength: [5, 'Password must be at least 5 characters long'],
        select: false // Don't include password in query results by default
    },
    company: {
        type: String,
        required: [true, 'Company name is required'],
        trim: true,
        maxlength: [100, 'Company name cannot be more than 100 characters']
    },
    role: {
        type: String,

        default: 'user'
    },
    comment: {
        type: String,
        trim: true,
        maxlength: [500, 'Comment cannot be more than 500 characters']
    }
}, {
    timestamps: true, // Adds createdAt and updatedAt fields
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Index for faster queries
userSchema.index({ email: 1 });
userSchema.index({ company: 1 });

// Hash password before saving
userSchema.pre('save', async function (next) {
    // Only hash the password if it has been modified (or is new)
    if (!this.isModified('password')) return next();

    try {
        // Generate salt and hash password
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (error) {
        next(error);
    }
});

// // Method to compare password
// userSchema.methods.comparePassword = async function (candidatePassword) {
//     try {
//         return await bcrypt.compare(candidatePassword, this.password);
//     } catch (error) {
//         throw new Error(error);
//     }
// };

// Virtual field for full user information
userSchema.virtual('userInfo').get(function () {
    return `${this.name} (${this.email}) - ${this.company}`;
});

// Instance method to get public profile
// userSchema.methods.getPublicProfile = function () {
//     const userObject = this.toObject();
//     delete userObject.password;
//     delete userObject.__v;
//     return userObject;
// };

// // Static method to find user by email
// userSchema.statics.findByEmail = function (email) {
//     return this.findOne({ email: email.toLowerCase() });
// };

const User = mongoose.model('User', userSchema);

module.exports = User;