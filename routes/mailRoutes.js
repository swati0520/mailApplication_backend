const express = require('express')
const { sendMail,  deleteSentMail, getSentMail, getRecivedMail } = require('../controllers/mailController')
const checkToken = require('../middleware/CheckToken')
const router = express.Router()


router.post('/create',checkToken,sendMail)
router.delete('/delete/:_id',checkToken,deleteSentMail)
router.get('/sentmails',checkToken,getSentMail)
router.get('/getMail',checkToken,getRecivedMail)


module.exports = router