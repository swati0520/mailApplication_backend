import mySql from "mysql2/promise"
import dotenv from "dotenv";

dotenv.config()

const db = mySql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
});

export const connectDB = async () => {
  try {
    const connection = await db.getConnection();
    console.log("MySQL Connected Successfully");
    connection.release();
  } catch (error) {
    // console.error(error);
    process.exit(1);
  }
};

export default db;
