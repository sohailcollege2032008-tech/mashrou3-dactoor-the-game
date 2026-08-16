class AppConstants {
  static const String appName = 'Med Royale';
  static const String ownerEmail = 'sohailcollege2032008@gmail.com';

  // Cloud Run Processor
  static const String cloudRunUrl = 'https://dactoor-processor-285933625241.europe-west1.run.app';
  static const String cloudRunSecret = 'dactoor-secret-2024';

  // Firebase Web/Android Options
  static const String firebaseApiKey = 'AIzaSyC64HmJxuPeJxpCyQ7i8LPNAJdlXBHK4ZI';
  static const String firebaseAppId = '1:285933625241:web:9b3edabc4af15a5f3bbd08';
  static const String firebaseMessagingSenderId = '285933625241';
  static const String firebaseProjectId = 'mashrou3-dactoor';
  static const String firebaseDatabaseUrl = 'https://mashrou3-dactoor-default-rtdb.europe-west1.firebasedatabase.app';
  static const String firebaseStorageBucket = 'mashrou3-dactoor.firebasestorage.app';
  static const String firebaseAuthDomain = 'mashrou3-dactoor.firebaseapp.com';

  // Gameplay Timers
  static const int questionDurationMs = 30000;
  static const int revealDurationMs = 4000;
  static const int forfeitTimeoutSeconds = 120;
}
