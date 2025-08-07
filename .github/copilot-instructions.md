# Food App (dish-scroll) Development Instructions

Always reference these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.

## Working Effectively

### Bootstrap and Dependencies

- Install pnpm globally: `npm install -g pnpm@10.8.0`
- Install all dependencies: `pnpm install --frozen-lockfile` -- takes 4 minutes, downloads ~2000 packages. NEVER CANCEL. Set timeout to 10+ minutes.
- Run formatting (works correctly): `pnpm format` -- takes 6 seconds.

### Build and Type Checking Status

- **CRITICAL**: Build and typecheck currently FAIL due to TypeScript errors in shared converters.
- The errors are in `shared/converters/` files with bigint vs number mismatches and null vs array type issues.
- Do NOT attempt to run `pnpm build` or `pnpm typecheck` expecting success - they will fail.
- Do NOT attempt to run `pnpm lint` - it fails due to eslint command not found in app-expo.

### Development Servers

#### API Development Server

- **WORKS**: Start API development server with required environment variables:
  ```bash
  cd api && API_COMMIT_ID=test API_NODE_ENV=development CORS_ORIGIN=http://localhost:3000 API_GOOGLE_PLACE_API_KEY=test_key pnpm dev
  ```
- Server runs despite TypeScript errors in watch mode
- Uses NestJS with hot reload on file changes
- Automatically copies Prisma files to dist/shared/prisma
- Runs on default NestJS port (usually 3000)
- **Expected behavior**: Shows TypeScript compilation errors but continues running in watch mode

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

- **API Tests**: Fail due to module resolution issues with `@shared/v1/dto` imports
- **App-Expo Tests**: Fail due to missing jest command
- **E2E Tests**: Not validated due to dependency on working API and app
- Do NOT expect test commands to work without first fixing module resolution

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
API_GOOGLE_PLACE_API_KEY=test_key
DATABASE_URL=postgresql://user:pass@host:port/dbname?schema=dev
```

### Production Deployment:

- See `.github/workflows/api-deploy.yml` for production environment variables
- Uses Google Cloud Run for API deployment
- Uses Supabase for database hosting

## Validation Scenarios

### Basic Development Workflow Validation

1. Clone repository and run `pnpm install --frozen-lockfile` (wait 4+ minutes)
2. Start API: `cd api && API_COMMIT_ID=test API_NODE_ENV=development CORS_ORIGIN=http://localhost:3000 API_GOOGLE_PLACE_API_KEY=test_key pnpm dev`
3. Start Expo app: `cd app-expo && pnpm start`
4. Verify API shows TypeScript errors but remains running in watch mode
5. Verify Expo shows "Waiting on http://localhost:8081" message
6. Run `pnpm format` to verify code formatting works

### Code Quality Validation

- **Format code**: `pnpm format` -- works correctly, uses Prettier
- **Linting**: Currently broken, do not rely on `pnpm lint`
- **Type checking**: Currently broken due to converter type mismatches
- **Building**: Currently broken, do not attempt `pnpm build`

### Manual Testing Scenarios

After making changes, always validate manually by:

#### API Testing

1. Start API server with required environment variables
2. API will show TypeScript compilation errors but continue running
3. Test API endpoints manually using curl or Postman
4. Example: `curl http://localhost:3000/health` (if health endpoint exists)
5. Watch console for request logs and error messages

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

- **API Configuration**: `api/src/config/env.ts` (environment validation)
- **Shared Types**: `shared/supabase/database.types.ts`, `shared/prisma/index.d.ts`
- **Expo Configuration**: `app-expo/app.config.ts`
- **Build Configuration**: `turbo.json`, `package.json` scripts
- **Database Schema**: `shared/prisma/schema.prisma`

## Common Commands Reference

### Working Commands (Validated)

```bash
# Dependencies and setup
npm install -g pnpm@10.8.0
pnpm install --frozen-lockfile  # 4+ minutes, NEVER CANCEL

# Development servers (working)
cd api && API_COMMIT_ID=test API_NODE_ENV=development CORS_ORIGIN=http://localhost:3000 API_GOOGLE_PLACE_API_KEY=test_key pnpm dev
cd app-expo && pnpm start

# Code quality (working)
pnpm format  # Prettier formatting
```

### Broken Commands (DO NOT USE)

```bash
# These commands are currently broken:
pnpm build        # Fails on TypeScript errors
pnpm typecheck    # Fails on TypeScript errors
pnpm lint         # Fails on missing eslint command
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

- **Dependency Installation**: 4 minutes (247 seconds) - NEVER CANCEL. Set timeout to 10+ minutes.
- **Format Command**: 6 seconds
- **API Dev Server Startup**: 5-10 seconds to show TypeScript errors, then continues running
- **Expo Dev Server Startup**: 10-15 seconds to start Metro bundler
- **Build/Typecheck**: 6 seconds (but fails)

## Known Issues and Workarounds

### TypeScript Conversion Errors

- Files affected: `shared/converters/convert_dish_categories.ts`, `convert_payouts.ts`, `convert_restaurant_bids.ts`
- Issue: Type mismatches between Supabase types (number/null) and Prisma types (bigint/string[])
- Workaround: Development servers run despite these errors

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

1. **Setup**: Install pnpm globally, run `pnpm install --frozen-lockfile` (wait 4+ minutes)
2. **API Development**: Use API dev command with environment variables, accept TypeScript errors
3. **Mobile Development**: Use `pnpm start` in app-expo directory
4. **Code Quality**: Use `pnpm format` for consistent formatting
5. **Manual Testing**: Test API endpoints and mobile app functionality manually
6. **Deployment**: Use GitHub Actions workflows for production deployment

Always validate your changes manually by running the development servers and testing the application functionality rather than relying on automated build/test processes.
