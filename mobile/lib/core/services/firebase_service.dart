import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_database/firebase_database.dart';
import 'package:firebase_storage/firebase_storage.dart';
import '../constants/app_constants.dart';

class FirebaseService {
  static FirebaseAuth get auth => FirebaseAuth.instance;
  static FirebaseFirestore get firestore => FirebaseFirestore.instance;
  static FirebaseDatabase get rtdb => FirebaseDatabase.instance;
  static FirebaseStorage get storage => FirebaseStorage.instance;

  static Future<void> initialize() async {
    try {
      if (Firebase.apps.isEmpty) {
        await Firebase.initializeApp(
          options: const FirebaseOptions(
            apiKey: AppConstants.firebaseApiKey,
            appId: AppConstants.firebaseAppId,
            messagingSenderId: AppConstants.firebaseMessagingSenderId,
            projectId: AppConstants.firebaseProjectId,
            databaseURL: AppConstants.firebaseDatabaseUrl,
            storageBucket: AppConstants.firebaseStorageBucket,
            authDomain: AppConstants.firebaseAuthDomain,
          ),
        );
      }
    } catch (_) {}
  }
}
