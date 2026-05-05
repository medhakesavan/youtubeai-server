// logger.js
import { createLogger, format, transports } from 'winston';
import moment from 'moment-timezone';

const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.errors({ stack: true }), // to log the stack trace
    format.splat(),
    format.json()
  ),
  transports: [
    new transports.File({ filename: 'error.log', level: 'error' }),
    new transports.File({ filename: 'combined.log' })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new transports.Console({
    format: format.combine(
      format.colorize(),
      format.simple()
    )
  }));
}
const timeInIndia = moment().utc();
console.log(timeInIndia);

// Calculate the time 5 hours ago
const fiveHoursAgoInIndia = timeInIndia.subtract(5, 'hours');

// Format the time in the required RFC 3339 format (UTC)
console.log(fiveHoursAgoInIndia.format());
export default logger;


