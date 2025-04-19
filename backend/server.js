const express = require('express');
const cors = require('cors');
const app = express();
const port = 5000;

const latestRoute = require('./routes/latest');

app.use(cors());
app.use(express.json());

app.use('/latest', latestRoute);

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

