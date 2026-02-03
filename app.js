const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const { Pool } = require('pg');
require('dotenv').config();

// Global variable to store database credentials
let dbConfig = null;
let pool = null;

const app = express();
const port = 3000;

// Check for environment variables
if (process.env.DB_HOST && process.env.DB_PORT && process.env.DB_NAME && process.env.DB_USER && process.env.DB_PASSWORD) {
    dbConfig = {
        host: process.env.DB_HOST,
        port: parseInt(process.env.DB_PORT),
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD
    };
    pool = new Pool(dbConfig);
    console.log("Database configured via environment variables.");
}

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public')); // For CSS/Images if needed
app.set('view engine', 'ejs');

app.use(session({
    secret: 'your_secret_key',
    resave: false,
    saveUninitialized: true,
}));


function isAuthenticated(req, res, next) {
    if (req.session.user) {
        next();
    } else {
        res.redirect('/login');
    }
}


function isInstructor(req, res, next) {
    if (req.session.user && req.session.user.role === 'instructor') {
        next();
    } else {
        res.status(403).send('Forbidden');
    }
}


// Function to get or initialize the pool
function getPool() {
    if (!pool && dbConfig) {
        pool = new Pool(dbConfig);
    }
    return pool;
}

// Route to serve the credentials form
// Route to serve the credentials form - DEPRECATED
// app.get('/', (req, res) => {
//     if (dbConfig) {
//         res.redirect('/login');
//     } else {
//         res.render('credentials');
//     }
// });

app.get('/', (req, res) => {
    res.redirect('/login');
});

// Route to handle credentials submission - DEPRECATED
// app.post('/set-credentials', (req, res) => {
//     ...
// });


app.get('/login', (req, res) => {
    if (req.session.user) {
        if (req.session.user.role === 'student') {
            return res.redirect('/student/dashboard');
        } else if (req.session.user.role === 'instructor') {
            return res.redirect('/instructor/dashboard');
        }
    }
    res.render('login');
});

// TODO: Implement user login logic
// 1. Check credentials in Users table
// 2. Set session user
// 3. Redirect to appropriate dashboard based on role
app.post('/login', async (req, res) => {
    const usname=req.body.username;
   const pswd=req.body.password;
   try{
    const dbres=await pool.query("select user_id,password,role,full_name from users where username = $1",[usname]);
    if (dbres.rows.length===0){
        return res.render("login",{error:"Invalid Login Credentials"});
    }
    const user=dbres.rows[0];
    if(user.password!== pswd){
        return res.render("login",{error:"Invalid login password or userid" });
    }
    req.session.user = {
        user_id:user.user_id,role:user.role
    };
    if(user.role === "student"){
       return res.redirect("/student/dashboard");   
    }
    if(user.role ==="instructor"){
        return res.redirect("/instructor/dashboard");
    }
    }
    catch(err){
        console.error(err);
        res.render("login",{error: "something is wrong"});
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});


// TODO: Render student dashboard
// 1. Fetch registered courses for the student
// 2. Fetch all available courses (exclude registered ones)
// 3. Calculate total credits
app.get('/student/dashboard', isAuthenticated, async (req, res) => {
    const userId = req.session.user.user_id;

    const name_query = "SELECT full_name FROM users WHERE user_id = $1";
    const reg_courses_query = "SELECT courses.* FROM courses JOIN registrations ON courses.course_id = registrations.course_id WHERE registrations.student_id = $1";
    const available_courses_query = "SELECT * FROM courses WHERE course_id NOT IN (SELECT course_id FROM registrations WHERE student_id = $1)";
    const total_credits_query = "SELECT SUM(c.credits) AS total_credits FROM courses c JOIN registrations r ON c.course_id = r.course_id WHERE r.student_id = $1";

    const name = (await pool.query(name_query, [userId])).rows[0].full_name;
    const registered_courses = (await pool.query(reg_courses_query, [userId])).rows;
    const available_courses = (await pool.query(available_courses_query, [userId])).rows;
    const total_credits_result = (await pool.query(total_credits_query, [userId])).rows;//can be empty
    const total_credits = total_credits_result[0].total_credits || 0;

    res.render('student_dashboard', {
        user: { ...req.session.user, full_name: name },
        registered_courses: registered_courses,
        available_courses: available_courses,
        total_credits: total_credits
    });
});

// TODO: Implement registration logic
// 1. Check if course exists
// 2. Check for Slot Clash (Cannot register for same slot twice)
// 3. Check Credit Limit (Max 24 credits)
// 4. Check Course Capacity (Optional)
// 5. Insert into Registrations table
app.post('/student/register', isAuthenticated, async (req, res) => {
    const userId = req.session.user.user_id;
    const courseId = req.body.course_id;

    //1. Check if course exists
    const course_check_query = "SELECT * FROM courses WHERE course_id = $1";
    const course_check_result = await pool.query(course_check_query, [courseId]);
    if (course_check_result.rows.length === 0) {
        return res.status(400).send("Course does not exist.");
    }

    const slot_credits_query = "SELECT slot, credits FROM courses WHERE course_id = $1";
    const slot = (await pool.query(slot_credits_query, [courseId])).rows[0].slot;
    const credits = Number((await pool.query(slot_credits_query, [courseId])).rows[0].credits);

    //2. Check for Slot Clash (Cannot register for same slot twice)
    const slots_taken_query = "SELECT c.slot FROM courses c JOIN registrations r ON c.course_id = r.course_id WHERE r.student_id = $1";
    const slots_taken = await pool.query(slots_taken_query, [userId]);
    if(slots_taken.rows.some(row => row.slot === slot)) {
        return res.status(400).send("Can't take this course, slot clash detected.");
    }

    //3. Check Credit Limit (Max 24 credits)
    const total_credits_query = "SELECT SUM(courses.credits) AS total_credits FROM courses JOIN registrations ON courses.course_id = registrations.course_id WHERE registrations.student_id = $1";
    const total_credits_result = await pool.query(total_credits_query, [userId]);//can be empty
    const total_credits = Number(total_credits_result.rows[0].total_credits) || 0;
    if(total_credits + credits > 24) {
        return res.status(400).send("Can't take this course, credit limit exceeded.");
    }

    //5. Insert into Registrations table
    const insert_registration_query = "INSERT INTO registrations (student_id, course_id) VALUES ($1, $2)";
    await pool.query(insert_registration_query, [userId, courseId]);

    res.redirect('/student/dashboard');
});

// TODO: Implement drop logic
// 1. Delete from Registrations table
app.post('/student/drop', isAuthenticated, async (req, res) => {
    const userId = req.session.user.user_id;
    const courseId = req.body.course_id;

    const delete_registration_query = "DELETE FROM registrations WHERE student_id = $1 AND course_id = $2";
    await pool.query(delete_registration_query, [userId, courseId]);

    res.redirect('/student/dashboard');
});


// TODO: Render instructor dashboard
// 1. Fetch courses taught by this instructor
app.get('/instructor/dashboard', isAuthenticated, isInstructor, async (req, res) => {
    const userID = req.session.user.user_id;

    const courses_teaching_query = "SELECT * FROM courses WHERE instructor_id = $1";
    const courses_teaching = (await pool.query(courses_teaching_query, [userID])).rows;

    res.render('instructor_dashboard', {
        user: req.session.user,
        courses: courses_teaching
    });

});

// TODO: Show students enrolled in a specific course
// 1. Verify instructor owns the course
// 2. Fetch enrolled students
app.get('/instructor/course/:id', isAuthenticated, isInstructor, async (req, res) => {

});


// TODO: Implement manual student addition
// 1. Check if student exists
// 2. Check if already enrolled
// 3. Check Credit Limit (If exceeded, allow but show WARNING)
// 4. Insert into Registrations
app.post('/instructor/add-student', isAuthenticated, isInstructor, async (req, res) => {

});


// TODO: Implement student removal
// 1. Delete from Registrations
app.post('/instructor/remove-student', isAuthenticated, isInstructor, async (req, res) => {

});


app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
