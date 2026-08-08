import jwt from "jsonwebtoken";

const checkToken = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({
      message: "Token not found",
    });
  }

  const token = authHeader.startsWith("Bearer ")
    ? authHeader.split(" ")[1]
    : authHeader;

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      if (err.name === "TokenExpiredError") {
        return res.status(401).json({
          message: "Token expired",
        });
      }

      return res.status(401).json({
        message: "Invalid token",
      });
    }

    req.user = decoded;
    next();
  });
};

export default checkToken;