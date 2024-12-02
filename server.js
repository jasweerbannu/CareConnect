const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');
const PgSession = require('connect-pg-simple')(session);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware setup
app.use(cors());
app.use(express.urlencoded({ extended: true })); // For form submissions
app.use(express.json()); // For JSON payloads
app.use(express.static('public')); // Serve static files

// PostgreSQL connection setup with timeout
const pool = new Pool({
    user: process.env.DB_USER || 'postgresql_careconnect_1_user',
    host: process.env.DB_HOST || 'dpg-ct6mfpdumphs739i4280-a',
    database: process.env.DB_NAME || 'postgresql_careconnect_1',
    password: process.env.DB_PASSWORD || '7pDQluC1YiBUXQPwktdOy3FlfHi3V3LL',
    port: 5432,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000, // Timeout after 5 seconds
});

// Test database connection on startup
pool.connect((err, client, release) => {
    if (err) {
        console.error('Error acquiring client:', err.stack);
    } else {
        console.log('Database connected successfully');
        release();
    }
});

// Session middleware with PostgreSQL store
app.use(
    session({
        store: new PgSession({
            pool: pool, // Reuse PostgreSQL pool
        }),
        secret: process.env.SESSION_SECRET || 'careconnectsecret',
        resave: false,
        saveUninitialized: false,
        cookie: { secure: false }, // Set to true if using HTTPS
    })
);

// Function to create tables
const createTables = async () => {
    try {
        console.log("Ensuring Patients table...");
        await pool.query(`
            DROP TABLE IF EXISTS patients CASCADE;
            CREATE TABLE IF NOT EXISTS patients (
                patient_id CHAR(12) NOT NULL,
                record_id CHAR(12) NOT NULL,
                record_name TEXT NOT NULL,
                uploaded_date DATE NOT NULL,
                test_date DATE NOT NULL,
                record_document BYTEA,
                PRIMARY KEY (patient_id, record_id)
            );
        `);
        console.log("Patients table ensured.");

        console.log("Ensuring Users table...");
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                patient_id CHAR(12) PRIMARY KEY,
                password TEXT NOT NULL,
                first_name VARCHAR(100),
                last_name VARCHAR(100),
                govt_health_id CHAR(12) UNIQUE NOT NULL
            );
        `);
        console.log("Users table ensured.");

        console.log("Ensuring Appointments table...");
        await pool.query(`
            CREATE TABLE IF NOT EXISTS appointments (
                appointment_id SERIAL PRIMARY KEY,
                patient_id CHAR(12) REFERENCES users(patient_id) ON DELETE CASCADE,
                hospital_id CHAR(12) NOT NULL,
                hospital_name TEXT NOT NULL,
                doctor_id CHAR(7) NOT NULL,
                doctor_name TEXT NOT NULL,
                reason_for_appointment TEXT,
                tests_done TEXT
            );
        `);
        console.log("Appointments table ensured.");

        console.log("Ensuring Communications table...");
        await pool.query(`
            CREATE TABLE IF NOT EXISTS communications (
                communicationid SERIAL PRIMARY KEY,
                patientid CHAR(12) NOT NULL,
                hospitalid CHAR(12) NOT NULL,
                hospitalname TEXT NOT NULL,
                doctorid CHAR(7) NOT NULL,
                doctorname TEXT NOT NULL,
                summaryofday TEXT NOT NULL,
                suggestionsrecommendations TEXT NOT NULL
            );
        `);
        console.log("Communications table ensured.");
    } catch (error) {
        console.error("Error creating tables:", error);
        process.exit(1); // Exit if table creation fails
    }
};

// Ensure tables are created on startup
createTables();

// Serve routes for static pages
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.get('/signup', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'signup.html'));
});
app.get('/dashboard', (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Password validation helper function
const validatePassword = (password) => {
    const regex = /^(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    return regex.test(password);
};

// Sign-up logic
app.post('/signup', async (req, res) => {
    const { first_name, last_name, govt_health_id, password, confirm_password } = req.body;

    if (password !== confirm_password) {
        return res.status(400).send("Passwords do not match!");
    }

    if (!validatePassword(password)) {
        return res.status(400).send(
            "Password must be at least 8 characters long, contain at least 1 uppercase letter, 1 symbol, and 1 number."
        );
    }

    try {
        const userResult = await pool.query('SELECT * FROM users WHERE govt_health_id = $1', [govt_health_id]);
        if (userResult.rows.length > 0) {
            return res.status(400).send('User with this Government Health ID already exists!');
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query(
            `INSERT INTO users (first_name, last_name, govt_health_id, patient_id, password) 
             VALUES ($1, $2, $3, $3, $4) RETURNING patient_id`,
            [first_name, last_name, govt_health_id, hashedPassword]
        );
        res.redirect('/login');
    } catch (error) {
        console.error('Error registering user:', error);
        res.status(500).send('Server error');
    }
});

// Login logic
app.post('/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const result = await pool.query('SELECT * FROM users WHERE govt_health_id = $1', [username]);
        const user = result.rows[0];
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ message: 'User ID or password is incorrect' });
        }

        req.session.userId = user.patient_id;
        req.session.save((err) => {
            if (err) {
                return res.status(500).send('Error saving session');
            }
            res.status(200).json({
                message: 'Login successful',
                user: {
                    patient_id: user.patient_id,
                    first_name: user.first_name,
                    last_name: user.last_name,
                    govt_health_id: user.govt_health_id,
                },
            });
        });
    } catch (error) {
        console.error('Error logging in:', error);
        res.status(500).send('Server error');
    }
});

// Logout logic
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).send('Failed to log out.');
        }
        res.redirect('/login');
    });
});

// **Your Mentioned Routes**
app.get('/patients/search', async (req, res) => {
    const { column, searchTerm } = req.query;

    if (!column || !searchTerm) {
        return res.status(400).json({ error: 'Please select a column and enter a search term.' });
    }

    try {
        const allowedColumns = ['record_id', 'record_name', 'uploaded_date', 'test_date'];
        if (!allowedColumns.includes(column)) {
            throw new Error('Invalid column name');
        }
        const query = `
            SELECT patient_id, record_id, record_name, uploaded_date, test_date,
            ENCODE(record_document, 'base64') AS record_document 
            FROM patients WHERE ${column}::TEXT ILIKE $1
        `;
        const result = await pool.query(query, [`%${searchTerm}%`]);

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'The item you are searching for is not found.' });
        }

        res.json(result.rows);
    } catch (error) {
        console.error('Error searching patients:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/patient-records', async (req, res) => {
    const { patientId } = req.query;

    if (!patientId) {
        return res.status(400).json({ error: "Patient ID is required" });
    }

    try {
        const result = await pool.query(
            'SELECT record_id, record_name, uploaded_date, test_date, ENCODE(record_document, \'base64\') as record_document FROM patients WHERE patient_id = $1',
            [patientId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "No patient records found" });
        }

        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching patient records:', error);
        res.status(500).json({ error: "Server error" });
    }
});

app.get('/api/appointments', async (req, res) => {
    const { patientId } = req.query;

    if (!patientId) {
        return res.status(400).json({ error: "Patient ID is required" });
    }

    try {
        const result = await pool.query(
            `SELECT appointment_id, hospital_id, hospital_name, doctor_id, doctor_name, reason_for_appointment, tests_done 
            FROM appointments 
            WHERE patient_id = $1`,
            [patientId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "No appointments found for this patient" });
        }

        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching appointments:', error);
        res.status(500).json({ error: "Server error" });
    }
});

app.get('/api/appointments/search', async (req, res) => {
    const { patientId, column, searchTerm } = req.query;

    if (!patientId || !column || !searchTerm) {
        return res.status(400).json({ error: 'Missing required query parameters' });
    }

    try {
        const query = `SELECT * FROM appointments WHERE patient_id = $1 AND ${column}::TEXT ILIKE $2`;
        const values = [patientId, `%${searchTerm}%`];
        const result = await pool.query(query, values);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'No appointments found' });
        }

        res.json(result.rows);
    } catch (error) {
        console.error('Error searching appointments:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/communications', async (req, res) => {
    const { patientId } = req.query;

    if (!patientId) {
        return res.status(400).json({ error: 'Patient ID is required' });
    }

    try {
        const result = await pool.query(
            'SELECT communicationid, hospitalid, hospitalname, doctorid, doctorname, summaryofday, suggestionsrecommendations FROM communications WHERE patientid = $1',
            [patientId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'No communication records found for this patient.' });
        }

        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching communications:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/communications/search', async (req, res) => {
    const { column, searchTerm, patientId } = req.query;

    if (!column || !searchTerm || !patientId) {
        return res.status(400).json({ error: 'Missing query parameters' });
    }

    const validColumns = ['hospitalname', 'doctorname', 'summaryofday'];
    if (!validColumns.includes(column)) {
        return res.status(400).json({ error: 'Invalid column for search' });
    }

    try {
        const query = `
            SELECT communicationid, hospitalid, hospitalname, doctorid, doctorname, summaryofday, suggestionsrecommendations
            FROM communications
            WHERE patientid = $1 AND ${column} ILIKE $2
        `;
        const values = [patientId, `%${searchTerm}%`];
        const result = await pool.query(query, values);

        if (result.rows.length === 0) {
            return res.status(404).json([]);
        }

        res.json(result.rows);
    } catch (error) {
        console.error('Error executing search:', error);
        res.status(500).json({ error: 'Server error while searching communications' });
    }
});

// Start the server after ensuring tables are created
const startServer = async () => {
    try {
        await createTables();
        app.listen(PORT, () => {
            console.log(`Server is running on port ${PORT}`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
    }
};

startServer();
