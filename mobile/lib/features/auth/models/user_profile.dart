class UserProfile {
  final String id;
  final String? email;
  final String? displayName;
  final String? avatarUrl;
  final String role; // 'owner' | 'host' | 'player'
  final DateTime? createdAt;
  final DateTime? lastLogin;

  UserProfile({
    required this.id,
    this.email,
    this.displayName,
    this.avatarUrl,
    this.role = 'player',
    this.createdAt,
    this.lastLogin,
  });

  bool get isOwner => role == 'owner';
  bool get isHost => role == 'host' || role == 'owner';
  bool get isPlayer => true;

  factory UserProfile.fromMap(String id, Map<String, dynamic> map) {
    return UserProfile(
      id: id,
      email: map['email'] as String?,
      displayName: map['display_name'] as String?,
      avatarUrl: map['avatar_url'] as String?,
      role: (map['role'] as String?) ?? 'player',
      createdAt: map['created_at'] != null ? DateTime.tryParse(map['created_at'].toString()) : null,
      lastLogin: map['last_login'] != null ? DateTime.tryParse(map['last_login'].toString()) : null,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'email': email,
      'display_name': displayName,
      'avatar_url': avatarUrl,
      'role': role,
      'created_at': createdAt?.toIso8601String(),
      'last_login': lastLogin?.toIso8601String(),
    };
  }

  UserProfile copyWith({
    String? displayName,
    String? avatarUrl,
    String? role,
  }) {
    return UserProfile(
      id: id,
      email: email,
      displayName: displayName ?? this.displayName,
      avatarUrl: avatarUrl ?? this.avatarUrl,
      role: role ?? this.role,
      createdAt: createdAt,
      lastLogin: lastLogin,
    );
  }
}
