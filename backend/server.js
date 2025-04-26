const express = require('express');
const cors = require('cors');
const app = express();
const port = 5000;

const latestRoute = require('./routes/latest');
const historicalRoute = require('./routes/historical'); // ✅ ADD THIS LINE

app.use(cors());
app.use(express.json());

app.use('/latest', latestRoute);
app.use('/historical', historicalRoute); // ✅ Now this will work

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

