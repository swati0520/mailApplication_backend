const express = require('express')
const { createUser, updateUser, loginUser, deleteUser, getUserDetails, forgetPassword, resetPsssword, passwordReset } = require('../controllers/userControllers')
const checkToken = require('../middleware/CheckToken')
const router = express.Router()


router.post('/create',createUser)
router.put('/update/',checkToken,updateUser)
router.delete('/delete',checkToken,deleteUser)
router.post('/login',loginUser)
router.get('/getuser',checkToken,getUserDetails)
router.post('/forgetPassword',forgetPassword)
router.get('/resetToken/:token',resetPsssword)
router.post('/resetToken/:token',passwordReset)





module.exports = router;

