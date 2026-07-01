require('dotenv').config();
const { getSellTime } = require('../service/get-sell-time');

getSellTime({
    asin: 'B0DTP8B4FZ',
    station: 'US',
}).then(res => {
    console.log(res);
})
