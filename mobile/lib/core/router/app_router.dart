import 'package:go_router/go_router.dart';
import '../../features/auth/screens/landing_screen.dart';
import '../../features/auth/screens/not_authorized_screen.dart';
import '../../features/dashboard/screens/player_dashboard_screen.dart';
import '../../features/deck_browser/screens/deck_browser_screen.dart';
import '../../features/duel/screens/duel_game_screen.dart';
import '../../features/duel/screens/duel_lobby_screen.dart';
import '../../features/duel/screens/duel_results_screen.dart';
import '../../features/host_dashboard/screens/host_dashboard_screen.dart';
import '../../features/host_dashboard/screens/host_game_room_screen.dart';
import '../../features/host_game/screens/join_game_screen.dart';
import '../../features/host_game/screens/player_game_view_screen.dart';
import '../../features/host_game/screens/waiting_room_screen.dart';
import '../../features/owner/screens/owner_dashboard_screen.dart';
import '../../features/owner/screens/sound_test_screen.dart';
import '../../features/profile/screens/player_profile_screen.dart';
import '../../features/tournament/screens/tournament_player_wait_screen.dart';

final GoRouter appRouter = GoRouter(
  initialLocation: '/',
  routes: [
    GoRoute(
      path: '/',
      builder: (context, state) => const LandingScreen(),
    ),
    GoRoute(
      path: '/not-authorized',
      builder: (context, state) => const NotAuthorizedScreen(),
    ),
    GoRoute(
      path: '/dashboard',
      builder: (context, state) => const PlayerDashboardScreen(),
    ),
    GoRoute(
      path: '/profile',
      builder: (context, state) => const PlayerProfileScreen(),
    ),
    GoRoute(
      path: '/decks',
      builder: (context, state) => const DeckBrowserScreen(),
    ),
    GoRoute(
      path: '/join',
      builder: (context, state) => const JoinGameScreen(),
    ),
    GoRoute(
      path: '/player/waiting/:roomId',
      builder: (context, state) {
        final roomId = state.pathParameters['roomId'] ?? '';
        return WaitingRoomScreen(roomId: roomId);
      },
    ),
    GoRoute(
      path: '/player/game/:roomId',
      builder: (context, state) {
        final roomId = state.pathParameters['roomId'] ?? '';
        return PlayerGameViewScreen(roomId: roomId);
      },
    ),
    GoRoute(
      path: '/duel/lobby/:duelId',
      builder: (context, state) {
        final duelId = state.pathParameters['duelId'] ?? '';
        return DuelLobbyScreen(duelId: duelId);
      },
    ),
    GoRoute(
      path: '/duel/game/:duelId',
      builder: (context, state) {
        final duelId = state.pathParameters['duelId'] ?? '';
        return DuelGameScreen(duelId: duelId);
      },
    ),
    GoRoute(
      path: '/duel/results/:duelId',
      builder: (context, state) {
        final duelId = state.pathParameters['duelId'] ?? '';
        return DuelResultsScreen(duelId: duelId);
      },
    ),
    GoRoute(
      path: '/host/dashboard',
      builder: (context, state) => const HostDashboardScreen(),
    ),
    GoRoute(
      path: '/host/game/:roomId',
      builder: (context, state) {
        final roomId = state.pathParameters['roomId'] ?? '';
        return HostGameRoomScreen(roomId: roomId);
      },
    ),
    GoRoute(
      path: '/owner/dashboard',
      builder: (context, state) => const OwnerDashboardScreen(),
    ),
    GoRoute(
      path: '/sound-test',
      builder: (context, state) => const SoundTestScreen(),
    ),
    GoRoute(
      path: '/tournament/:tournamentId/wait',
      builder: (context, state) {
        final tournamentId = state.pathParameters['tournamentId'] ?? '';
        return TournamentPlayerWaitScreen(tournamentId: tournamentId);
      },
    ),
  ],
);
