import { google } from 'googleapis';
const youtube = google.youtube('v3');
console.log('Comments methods:', Object.keys(youtube.comments));
