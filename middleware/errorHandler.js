const errorHandler = (error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  const isFileTooLarge = error.code === "LIMIT_FILE_SIZE";
  const statusCode = isFileTooLarge
    ? 413
    : res.statusCode >= 400
      ? res.statusCode
      : 500;

  return res.status(statusCode).json({
    message:
      statusCode === 500
        ? "Internal server error"
        : error.message,
  });
};

export default errorHandler;
