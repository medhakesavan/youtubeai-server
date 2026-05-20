import { google } from 'googleapis';
const youtube = google.youtube('v3');
// Explore the structure
console.log('Youtube keys:', Object.keys(youtube));
if (youtube.comments) {
    console.log('Comments methods:', Object.keys(youtube.comments));
}
if (youtube.commentThreads) {
    console.log('CommentThreads methods:', Object.keys(youtube.commentThreads));
}
