const jwt = require('jsonwebtoken')


const checkToken = async (req, res, next) => {
  let token = req.headers.authorization;

  if (!token) {
    return res.status(400).json({ message: "token not found" });
  }

  jwt.verify(token, process.env.JWT_SECRET, function (err, decoded) {
    if (err) {
      if (err.name === "TokenExpiredError") {
        return res.status(401).json({ message: "token expired" });
      } else if (err.name === "JsonWebTokenError") {
        return res.status(401).json({ message: "invalid token" });
      } else {
        return res.json({ message: "authentication failed" });
      }
    }
    req.user = decoded
    next()
  });
};

module.exports = checkToken