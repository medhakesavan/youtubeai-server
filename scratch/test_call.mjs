import { google } from 'googleapis';
const youtube = google.youtube('v3');
try {
    console.log('Testing setRating call...');
    // This will likely fail because we don't have real auth, but we want to see if the METHOD exists
    youtube.comments.setRating({ id: 'test', rating: 'like' });
} catch (e) {
    console.log('Error type:', e.message);
}
