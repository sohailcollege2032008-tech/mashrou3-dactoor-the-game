import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_sign_in/google_sign_in.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/services/firebase_service.dart';
import '../models/user_profile.dart';

final authStateProvider = StreamProvider<User?>((ref) {
  return FirebaseService.auth.authStateChanges();
});

class AuthState {
  final User? user;
  final UserProfile? profile;
  final bool isLoading;
  final String? errorMessage;

  const AuthState({
    this.user,
    this.profile,
    this.isLoading = true,
    this.errorMessage,
  });

  bool get isAuthenticated => user != null;

  AuthState copyWith({
    User? user,
    UserProfile? profile,
    bool? isLoading,
    String? errorMessage,
  }) {
    return AuthState(
      user: user ?? this.user,
      profile: profile ?? this.profile,
      isLoading: isLoading ?? this.isLoading,
      errorMessage: errorMessage,
    );
  }
}

class AuthNotifier extends StateNotifier<AuthState> {
  AuthNotifier() : super(const AuthState()) {
    _initialize();
  }

  void _initialize() {
    FirebaseService.auth.authStateChanges().listen((User? user) async {
      if (user != null) {
        state = state.copyWith(user: user, isLoading: true);
        await fetchProfile(user);
      } else {
        state = const AuthState(isLoading: false);
      }
    });
  }

  Future<void> fetchProfile(User user) async {
    try {
      final docRef = FirebaseService.firestore.collection('profiles').doc(user.uid);
      final docSnap = await docRef.get();

      final correctRole = await _calculateRole(user.email);

      if (docSnap.exists) {
        final data = docSnap.data()!;
        UserProfile profile = UserProfile.fromMap(user.uid, data);

        if (profile.role != correctRole) {
          await docRef.update({'role': correctRole});
          profile = profile.copyWith(role: correctRole);
        }

        state = state.copyWith(user: user, profile: profile, isLoading: false);
      } else {
        final newProfile = UserProfile(
          id: user.uid,
          email: user.email,
          displayName: user.displayName ?? (user.email?.split('@').first ?? 'Player'),
          avatarUrl: user.photoURL,
          role: correctRole,
          createdAt: DateTime.now(),
          lastLogin: DateTime.now(),
        );

        await docRef.set(newProfile.toMap());
        state = state.copyWith(user: user, profile: newProfile, isLoading: false);
      }
    } catch (e) {
      state = state.copyWith(user: user, isLoading: false, errorMessage: e.toString());
    }
  }

  Future<String> _calculateRole(String? email) async {
    if (email == null) return 'player';
    if (email.toLowerCase() == AppConstants.ownerEmail.toLowerCase()) {
      return 'owner';
    }

    try {
      final snap = await FirebaseService.firestore
          .collection('authorized_hosts')
          .where('email', isEqualTo: email.toLowerCase())
          .where('is_active', isEqualTo: true)
          .get();

      if (snap.docs.isNotEmpty) {
        return 'host';
      }
    } catch (_) {}

    return 'player';
  }

  Future<bool> signInWithGoogle() async {
    state = state.copyWith(isLoading: true, errorMessage: null);
    try {
      final GoogleSignIn googleSignIn = GoogleSignIn();
      final GoogleSignInAccount? googleUser = await googleSignIn.signIn();

      if (googleUser == null) {
        state = state.copyWith(isLoading: false);
        return false;
      }

      final GoogleSignInAuthentication googleAuth = await googleUser.authentication;
      final OAuthCredential credential = GoogleAuthProvider.credential(
        accessToken: googleAuth.accessToken,
        idToken: googleAuth.idToken,
      );

      final userCredential = await FirebaseService.auth.signInWithCredential(credential);
      if (userCredential.user != null) {
        await fetchProfile(userCredential.user!);
        return true;
      }
      return false;
    } catch (e) {
      state = state.copyWith(isLoading: false, errorMessage: e.toString());
      return false;
    }
  }

  Future<void> updateProfile({String? displayName, String? avatarUrl}) async {
    if (state.user == null) return;
    try {
      final uid = state.user!.uid;
      final updates = <String, dynamic>{};
      if (displayName != null) updates['display_name'] = displayName;
      if (avatarUrl != null) updates['avatar_url'] = avatarUrl;

      if (updates.isNotEmpty) {
        await FirebaseService.firestore.collection('profiles').doc(uid).update(updates);
        if (state.profile != null) {
          state = state.copyWith(
            profile: state.profile!.copyWith(
              displayName: displayName,
              avatarUrl: avatarUrl,
            ),
          );
        }
      }
    } catch (_) {}
  }

  Future<void> signOut() async {
    await FirebaseService.auth.signOut();
    try {
      await GoogleSignIn().signOut();
    } catch (_) {}
    state = const AuthState(isLoading: false);
  }
}

final authNotifierProvider = StateNotifierProvider<AuthNotifier, AuthState>((ref) {
  return AuthNotifier();
});
