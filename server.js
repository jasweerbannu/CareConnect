const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
// Middleware to parse URL-encoded bodies (for form submissions)
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

// Session middleware
app.use(session({
    secret: 'careconnectsecret',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }  // Set to true if using HTTPS
}));

// PostgreSQL connection setup
const pool = new Pool({
    user: 'manasa',
    host: 'dpg-csg8sae8ii6s739dpqsg-a.oregon-postgres.render.com',
    database: 'care_connect_75ii',
    password: 'fXpuygKyI3AwexBiv5PHwkcJkCCQupIW',
    port: 5432,
    ssl: { rejectUnauthorized: false }
});

module.exports = pool;

// Function to create tables if they do not exist
const createTables = async () => {
    try {
        // Check if the 'patients' table exists
        const checkPatientsTable = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'patients'
            );
        `);

        if (!checkPatientsTable.rows[0].exists) {
            // Create the patients table if it does not exist
            await pool.query(`
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
            console.log("Patients table created successfully.");
        }

        // Check if the 'appointments' table exists
        const checkAppointmentsTable = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'appointments'
            );
        `);

        if (!checkAppointmentsTable.rows[0].exists) {
            // Create the appointments table if it does not exist
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
            console.log("Appointments table created successfully.");
        }

        // Check if the 'users' table exists
        const checkUsersTable = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'users'
            );
        `);

        if (!checkUsersTable.rows[0].exists) {
            // Create the users table if it does not exist
            await pool.query(`
                CREATE TABLE IF NOT EXISTS users (
                    patient_id CHAR(12) PRIMARY KEY,
                    password TEXT NOT NULL,
                    first_name VARCHAR(100),
                    last_name VARCHAR(100),
                    govt_health_id CHAR(12) UNIQUE NOT NULL
                );

            `);
            console.log("Users table created successfully.");
        }

        const checkCommunicationsTable = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'Communications'
            );
        `);

        if (!checkCommunicationsTable.rows[0].exists) {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS Communications (
                    CommunicationId SERIAL PRIMARY KEY,
                    PatientId CHAR(12) NOT NULL,
                    HospitalId CHAR(12) NOT NULL,
                    HospitalName TEXT NOT NULL,
                    DoctorId CHAR(7) NOT NULL,
                    DoctorName TEXT NOT NULL,
                    SummaryOfDay TEXT NOT NULL,
                    SuggestionsRecommendations TEXT NOT NULL
                );

             `);
             console.log("Communications table created successfully.");
        }

    } catch (error) {
        console.error("Error creating tables:", error);
    }
};

// Call createTables function to ensure tables are created on startup
createTables();

// Serve the home page on the root URL
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html')); // Make sure this file exists in 'public' folder
});

// Serve the login page after the home page
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Serve the sign-up page
app.get('/signup', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'signup.html'));
});

// Serve the dashboard page after login
app.get('/dashboard', (req, res) => {
    if (!req.session.userId) {
        console.log('inside the if cond');
        return res.redirect('/login');
    }
    console.log('opening the dashboard page');
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Serve the appointment page for logged-in users
app.get('/appointments', (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }
    res.sendFile(path.join(__dirname, 'public', 'appointments.html'));
});

app.post('/signup', async (req, res) => {
    console.log('Received data:', req.body); // Log to check if data is coming in

    const { first_name, last_name, govt_health_id, password, confirm_password } = req.body;

    if (password !== confirm_password) {
        return res.status(400).send("Passwords do not match!");
    }

    if (!validatePassword(password)) {
        return res.status(400).send("Password must be at least 8 characters long, contain at least 1 uppercase letter, 1 symbol, and 1 number.");
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

const validatePassword = (password) => {
    const regex = /^(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    console.log('Password validation result:', regex.test(password)); // Log the result of validation
    return regex.test(password);
};

app.post('/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        // Query to find the user with the given username (govt_health_id)
        const result = await pool.query('SELECT * FROM users WHERE govt_health_id = $1', [username]);
        console.log('Query result:', result);

        const user = result.rows[0];

        // Check if user is found
        if (!user) {
            console.log('No user found with govt_health_id:', username);
            return res.status(401).json({ message: 'User ID or password is incorrect' });
        }

        console.log('User from DB:', user);
        console.log('Provided password:', password);
        console.log('Stored hash:', user.password);

        // If the password doesn't match
        const isPasswordValid = await bcrypt.compare(password, user.password);
        console.log('Password match result:', isPasswordValid);

        if (!isPasswordValid) {
            console.log('Password match failed');
            return res.status(401).json({ message: 'User ID or password is incorrect' });
        }

        // If login is successful, set session
        req.session.userId = user.patient_id;
        req.session.save((err) => {
            if (err) {
                console.error('Session save error:', err);
                return res.status(500).send('Error saving session');
            }

            // Send user profile data as JSON response
            res.status(200).json({
                message: 'Login successful',
                user: {
                    patient_id: user.patient_id,
                    first_name: user.first_name,
                    last_name: user.last_name,
                    govt_health_id: user.govt_health_id
                }
            });
        });
    } catch (error) {
        console.error('Error logging in:', error);
        res.status(500).send('Server error');
    }
});


// Handle logout
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).send('Failed to log out.');
        }
        res.redirect('/login');
    });
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

// Route to search patient records based on a specific column and search term
app.get('/patients/search', async (req, res) => {
    const { column, searchTerm } = req.query;

    // Check if both column and search term are provided
    if (!column || !searchTerm) {
        return res.status(400).json({ error: 'Please select a column and enter a search term.' });
    }

    try {
        const allowedColumns = ['record_id', 'record_name', 'uploaded_date', 'test_date'];
        if (!allowedColumns.includes(column)) {
            throw new Error('Invalid column name');
        }
        // Construct the query with necessary type casting for DATE columns
        const query = `
        SELECT patient_id, record_id, 
            record_name, 
            uploaded_date, 
            test_date, 
            ENCODE(record_document, 'base64') AS record_document 
        FROM patients 
        WHERE ${column}::TEXT ILIKE $1
        `;

        // Execute the query with the search term, adding '%' for partial matches
        const result = await pool.query(query, [`%${searchTerm}%`]);


        // If no records are found, return a 404 status with a message
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'The item you are searching for is not found.' });
        }

        // Send the found records as a JSON response
        res.json(result.rows);
    } catch (error) {
        console.error('Error searching patients:', error);
        res.status(500).json({ error: 'Server error' });
    }
});


app.get('/api/patient-records', async (req, res) => {
    const { patientId } = req.query; // Get patientId from query parameters

    if (!patientId) {
        return res.status(400).json({ error: "Patient ID is required" });
    }

    try {
        // Query the database for patient records
       // When fetching records, base64-encode record_document
        const result = await pool.query('SELECT record_id, record_name, uploaded_date, test_date, ENCODE(record_document, \'base64\') as record_document FROM patients WHERE patient_id = $1', [patientId]);


        // If no records found, return a 404 error
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "No patient records found" });
        }

        // Return the patient records as a JSON response
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching patient records:', error);
        res.status(500).json({ error: "Server error" });
    }
});
app.get('/api/appointments', async (req, res) => {
    const { patientId } = req.query;

    // Ensure that a patientId is provided
    if (!patientId) {
        return res.status(400).json({ error: "Patient ID is required" });
    }

    try {
        // Fetch appointments for the specified patient ID
        const result = await pool.query(
            `SELECT appointment_id, hospital_id, hospital_name, doctor_id, doctor_name, reason_for_appointment, tests_done 
            FROM appointments 
            WHERE patient_id = $1`, 
            [patientId]
        );

        // If no appointments found, return 404
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "No appointments found for this patient" });
        }

        // Send the appointment data as JSON
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
        // Create a dynamic query that uses parameterized inputs for security
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

// Route to fetch communications based on patientId
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
