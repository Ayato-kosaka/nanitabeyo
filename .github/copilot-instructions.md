# Food App (nanitabeyo) Development Instructions

Always reference these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.

## Working Effectively

### Bootstrap and Dependencies

- Install pnpm globally: `npm install -g pnpm@10.8.0`
- Install all dependencies: `pnpm install --frozen-lockfile` -- takes 1 minute 10 seconds, downloads ~2000 packages. NEVER CANCEL. Set timeout to 5+ minutes.
- Run formatting (works correctly): `pnpm format` -- takes 6-7 seconds.

### Build and Type Checking Status

- **BUILD WORKS**: `pnpm build` succeeds in ~12 seconds. You CAN build the codebase.
- **TYPECHECK WORKS**: `pnpm typecheck` succeeds in ~9 seconds. TypeScript validation passes.
- **LINTING PARTIALLY WORKS**: `pnpm lint` fails only in app-expo due to missing eslint command, but api linting works.

### Development Servers

#### API Development Server

- **REQUIRES COMPLETE .ENV**: Start API development server with ALL required environment variables in `api/.env` file:
  ```bash
  cd api && pnpm dev
  ```
- Requires comprehensive environment variables (see Environment Variables section below)
- Server fails without proper .env file containing DB_SCHEMA, SUPABASE_JWT_SECRET, GCS_BUCKET_NAME, etc.
- Uses NestJS with hot reload on file changes
- Automatically copies Prisma files to dist/shared/prisma
- Runs on default NestJS port (usually 3000)

#### Expo App Development Server

- **WORKS**: Start Expo development server without tunnel:
  ```bash
  cd app-expo && pnpm start
  ```
- Runs on port 8081
- Do NOT use `pnpm dev` (fails due to tunnel requiring interactive ngrok installation)
- Metro bundler runs in CI mode (reloads disabled)

#### Full Development Environment

- Start both servers separately in different terminals
- API: Use the API command above
- Expo: Use `cd app-expo && pnpm start`
- Do NOT use `pnpm dev` from root - it fails on the Expo tunnel requirement

### Testing Status

- **API Tests**: Partially pass - some fail due to module resolution issues with `@shared/v1/dto` imports
- **API Functional Tests**: Available for dish-categories endpoint - `cd api && pnpm test:functional:dish-categories`
- **App-Expo Tests**: Fail due to missing jest command
- **E2E Tests**: Available but require working API and app servers (Detox framework)
- Do NOT expect all test commands to work without first fixing module resolution

### Database and Prisma

- Uses PostgreSQL with Prisma ORM
- Prisma client is generated in `shared/prisma/`
- Database schema is in `shared/prisma/schema.prisma`
- Migration scripts available in `scripts/` directory
- **Database connection**: Requires `DATABASE_URL` environment variable for actual database operations
- **Schema**: Uses multi-schema setup with "dev" schema

## Environment Variables Required

### API Development (.env in api/ directory):

```
API_COMMIT_ID=test
API_NODE_ENV=development
CORS_ORIGIN=http://localhost:3000
DB_SCHEMA=dev
SUPABASE_JWT_SECRET=test_jwt_secret
GOOGLE_PLACE_API_KEY=test_key
GCS_BUCKET_NAME=test_bucket
GCS_STATIC_MASTER_DIR_PATH=static
CLAUDE_API_KEY=test_claude_key
GOOGLE_API_KEY=test_google_key
GOOGLE_SEARCH_ENGINE_ID=test_search_engine
GCP_PROJECT=test_project
TASKS_LOCATION=us-central1
CLOUD_RUN_URL=http://localhost:3000
TASKS_INVOKER_SA=test@test.iam.gserviceaccount.com
DATABASE_URL=postgresql://user:pass@host:port/dbname?schema=dev
```

### Production Deployment:

- See `.github/workflows/api-deploy.yml` for production environment variables
- Uses Google Cloud Run for API deployment
- Uses Supabase for database hosting

## Validation Scenarios

### Basic Development Workflow Validation

1. Clone repository and run `pnpm install --frozen-lockfile` (wait 1+ minutes)
2. Create `api/.env` file with all required environment variables (see Environment Variables section)
3. Start API: `cd api && pnpm dev` (requires complete .env file)
4. Start Expo app: `cd app-expo && pnpm start`
5. Verify API starts without environment validation errors
6. Verify Expo shows "Waiting on http://localhost:8081" message
7. Run `pnpm format` to verify code formatting works

### Code Quality Validation

- **Format code**: `pnpm format` -- works correctly in ~7 seconds, uses Prettier
- **Build code**: `pnpm build` -- WORKS in ~12 seconds. Set timeout to 30+ seconds.
- **Type checking**: `pnpm typecheck` -- WORKS in ~9 seconds. Set timeout to 30+ seconds.
- **Linting**: `pnpm lint` -- partially broken (app-expo eslint missing), api linting works

### Manual Testing Scenarios

After making changes, always validate manually by:

#### API Testing

1. Create `api/.env` file with all required environment variables (see Environment Variables section)
2. Start API server: `cd api && pnpm dev`
3. API will start successfully if all environment variables are provided
4. Test API endpoints manually using curl or Postman
5. Example: `curl http://localhost:3000/health` (if health endpoint exists)
6. Watch console for request logs and error messages

#### Mobile App Testing

1. Start Expo server with `pnpm start` in app-expo directory
2. View the app in Expo Go on device or web browser at http://localhost:8081
3. Test basic navigation and functionality
4. Check Metro bundler console for JavaScript errors
5. Verify hot reload works by making small UI changes

#### End-to-End Workflow Testing

1. Start both API and Expo servers simultaneously
2. Test data flow between mobile app and API
3. Verify real-time features work correctly
4. Test offline/online behavior if applicable

## Project Structure

### Monorepo Organization

- **Root**: Uses pnpm workspaces and Turbo for build orchestration
- **api/**: NestJS backend with Prisma ORM, Google Cloud services integration
- **app-expo/**: React Native mobile app with Expo, Zustand state management
- **shared/**: Shared utilities, DTOs, Prisma schema, database types
- **e2e/**: Detox end-to-end testing (not currently functional)

### Key Technologies

- **Backend**: NestJS, Prisma, PostgreSQL, Google Cloud APIs (Vision, Storage, Places)
- **Frontend**: React Native, Expo Router, Zustand, Supabase client
- **Database**: PostgreSQL hosted on Supabase with multi-schema setup
- **Build Tools**: Turbo (monorepo), pnpm (package manager), TypeScript
- **Infrastructure**: Google Cloud Run, Firebase, Supabase

### Important File Locations

- **API Configuration**: `api/src/core/config/env.ts` (environment validation)
- **API Environment**: `api/.env` (create this file with all required variables)
- **Shared Types**: `shared/supabase/database.types.ts`, `shared/prisma/index.d.ts`
- **Expo Configuration**: `app-expo/app.config.ts`
- **Build Configuration**: `turbo.json`, `package.json` scripts
- **Database Schema**: `shared/prisma/schema.prisma`
- **Database Scripts**: `scripts/` directory (apply-migration.sh, db-pull.sh, reset-schema.sh)
- **Functional Tests**: `api/test/functional/v1/dish-categories/` (comprehensive API testing)
- **GitHub Workflows**: `.github/workflows/` (api-deploy.yml, eas-build-\*.yml, etc.)

## Common Commands Reference

### Working Commands (Validated)

```bash
# Dependencies and setup (VALIDATED TIMINGS)
npm install -g pnpm@10.8.0
pnpm install --frozen-lockfile  # 1m 10s, NEVER CANCEL

# Development servers (working)
cd api && pnpm dev  # requires complete .env file
cd app-expo && pnpm start

# Code quality (working)
pnpm format  # Prettier formatting (~7 seconds)
pnpm build   # Build codebase (~12 seconds)
pnpm typecheck  # TypeScript validation (~9 seconds)
```

### Broken Commands (DO NOT USE)

```bash
# These commands are currently broken:
pnpm lint         # Fails on missing eslint in app-expo (api linting works)
pnpm test         # Fails on module resolution
pnpm dev          # Fails on Expo tunnel requirements
```

### Database Commands (Require Database Connection)

```bash
pnpm db:migration  # Apply database migrations
pnpm db:pull       # Pull database schema
pnpm db:reset      # Reset database schema
```

## Timing Expectations

- **Dependency Installation**: 1 minute 10 seconds - NEVER CANCEL. Set timeout to 5+ minutes.
- **Format Command**: 6-7 seconds
- **Build Command**: 12 seconds - Set timeout to 30+ seconds.
- **Typecheck Command**: 9 seconds - Set timeout to 30+ seconds.
- **API Dev Server Startup**: 5-10 seconds with proper .env, fails immediately without required environment variables
- **Expo Dev Server Startup**: 10-15 seconds to start Metro bundler

## Known Issues and Workarounds

### Environment Variable Issues

- API requires comprehensive .env file with 15+ environment variables
- Missing any required environment variable causes immediate startup failure
- Use complete .env template provided in Environment Variables section
- Development servers cannot run without proper environment configuration

### Linting Issues

- app-expo package missing eslint command
- api linting may work individually but not through Turbo
- Workaround: Use `pnpm format` for code formatting

### Test Configuration Issues

- API tests fail on `@shared/v1/dto` import resolution
- app-expo missing jest configuration
- Workaround: Manual testing of API endpoints and Expo app functionality

### Expo Development Issues

- Tunnel mode requires interactive ngrok installation
- Workaround: Use `pnpm start` instead of `pnpm dev` in app-expo

## Working Development Workflow

1. **Setup**: Install pnpm globally, run `pnpm install --frozen-lockfile` (wait 1+ minutes)
2. **Environment Setup**: Create complete `api/.env` file with all required variables
3. **API Development**: Use `cd api && pnpm dev` with proper environment configuration
4. **Mobile Development**: Use `pnpm start` in app-expo directory
5. **Code Quality**: Use `pnpm format`, `pnpm build`, `pnpm typecheck` (all work correctly)
6. **Manual Testing**: Test API endpoints and mobile app functionality manually
7. **Deployment**: Use GitHub Actions workflows for production deployment

### Infrastructure and Deployment

- **Google Cloud Setup**: `infra/gcp/create_api_dev_service_account.sh` (service account creation)
- **API Deployment**: Google Cloud Run via `.github/workflows/api-deploy.yml`
- **Mobile App**: Expo Application Services (EAS) via multiple workflows
- **Database**: Supabase PostgreSQL with multi-schema setup
- **Firebase**: Storage and hosting via `firebase-hosting-deploy.yml`

Always validate your changes manually by running the development servers and testing the application functionality rather than relying on automated build/test processes.

## CRITICAL Command Timeouts

When using these commands, set explicit timeouts to prevent premature cancellation:

- `pnpm install --frozen-lockfile`: Set timeout to 300+ seconds (5+ minutes)
- `pnpm build`: Set timeout to 60+ seconds
- `pnpm typecheck`: Set timeout to 60+ seconds
- `pnpm format`: Set timeout to 30+ seconds
- API development server startup: Set timeout to 60+ seconds for initial compilation
- Expo development server startup: Set timeout to 60+ seconds for Metro bundler

## Comprehensive Validation Scenarios

### Pre-Development Setup Validation

1. Install pnpm: `npm install -g pnpm@10.8.0`
2. Install dependencies: `pnpm install --frozen-lockfile` (1m 10s)
3. Test formatting: `pnpm format` (7s)
4. Test build: `pnpm build` (12s)
5. Test typecheck: `pnpm typecheck` (9s)

### API Development Validation

1. Create `api/.env` with all required environment variables
2. Start API: `cd api && pnpm dev`
3. Verify server starts without environment validation errors
4. Test basic endpoint: `curl http://localhost:3000` (may return 404, but server responds)
5. Verify hot reload by editing a source file

### Mobile App Development Validation

1. Start Expo: `cd app-expo && pnpm start`
2. Verify Metro bundler starts and shows "Waiting on http://localhost:8081"
3. Open browser to http://localhost:8081 to see Expo DevTools
4. Verify app can be opened in web browser or Expo Go
5. Test hot reload by editing a React component

### Full Stack Validation

1. Start API server in one terminal: `cd api && pnpm dev`
2. Start Expo server in another terminal: `cd app-expo && pnpm start`
3. Verify both servers run simultaneously without conflicts
4. Test communication between frontend and backend (if endpoints available)
5. Verify hot reload works in both API and mobile app
