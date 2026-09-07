import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class CredentialsDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  email?: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  password?: string;
}

/**
 * EXACTLY WHAT WE ASK THE USER FOR.
 *
 * Three things: a URL, the requirements, and (optionally) test credentials.
 * Plus one authorisation checkbox, because we are about to open somebody's
 * website with an automated browser.
 *
 * `url` is the ENTRY point. With crawlEnabled it is the front door of the app
 * and every other page is discovered from it; without, it is the one page under
 * test. Either way it is the only URL the user has to type.
 */
export class CreateRunDto {
  @IsUrl(
    { require_tld: false, require_protocol: true },
    { message: 'url must be a full URL including http:// or https://' },
  )
  url!: string;

  /**
   * Free text, one requirement per line. The source of truth for business rules.
   *
   * Optional now: a run is valid with ticked checks and no prose, because the
   * standard checks carry their own meaning. One of the two must be present -
   * enforced in the service, since neither field alone can express that.
   */
  @IsOptional()
  @IsString()
  @Length(0, 20000)
  requirements?: string;

  /**
   * Ids from the check catalogue — the boxes the user ticked.
   * Unknown ids are dropped rather than rejected, so an older client cannot
   * break against a newer catalogue.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  checks?: string[];

  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CredentialsDto)
  credentials?: CredentialsDto;

  /**
   * Where to sign in, when the target page sits behind a login.
   *
   * Given this plus credentials, the platform signs in once BEFORE scanning and
   * reuses that session for every test. Without it, a protected URL redirects
   * to the login page and every generated test describes the wrong page.
   */
  @IsOptional()
  @IsUrl(
    { require_tld: false, require_protocol: true },
    { message: 'loginUrl must be a full URL including http:// or https://' },
  )
  loginUrl?: string;

  /**
   * Explicit control labels for the sign-in form, for the cases where
   * auto-detection cannot find them (icon-only buttons, unlabelled inputs).
   */
  @IsOptional()
  @IsString()
  @Length(1, 120)
  loginEmailField?: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  loginPassField?: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  loginSubmit?: string;

  /**
   * Figma design to check the page against.
   *
   * Taken from a Figma URL: figma.com/design/<fileKey>/Name?node-id=<nodeId>.
   * Both are needed - the file alone is usually a whole design system, and
   * comparing a login page against every component in it is meaningless.
   */
  @IsOptional()
  @IsString()
  @Length(10, 128)
  figmaFileKey?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  figmaNodeId?: string;

  /**
   * WHICH PAGE the Figma frame describes. Defaults to the entry URL.
   *
   * The design comparison is single-page even when the run covers the whole
   * app, because a Figma frame IS one screen. This field is how a whole-app run
   * says "crawl everything, but compare the design against /settings" - the
   * page the frame was drawn for. Must be on the site under test.
   */
  @IsOptional()
  @IsUrl(
    { require_tld: false, require_protocol: true },
    { message: 'designPageUrl must be a full URL including http:// or https://' },
  )
  designPageUrl?: string;

  // ------------------------------------------------------------- whole app ---

  /**
   * TEST THE WHOLE APP, not just the URL given.
   *
   * On: the platform follows same-origin links from `url` to find the app's
   * pages, then scans, plans and runs tests against every one of them - one
   * run, one approval gate, one findings list. Off (the default): the original
   * behaviour, `url` and nothing else.
   */
  @IsOptional()
  @IsBoolean()
  crawlEnabled?: boolean;

  /**
   * Page budget. Every page costs one browser scan plus one LLM call, so this
   * is the main cost dial. Clamped server-side to CRAWL_MAX_PAGES_HARD.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  maxPages?: number;

  /** Link depth from the entry URL. 1 = only what the entry page links to. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxDepth?: number;

  /**
   * Restrict the crawl to paths containing one of these, e.g. ["/admin"].
   * Empty means the whole origin.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Length(1, 200, { each: true })
  includePaths?: string[];

  /**
   * Skip paths containing one of these. Applied on top of the always-excluded
   * set in site-crawler.service.ts, which already covers sign-out and anything
   * that looks destructive.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Length(1, 200, { each: true })
  excludePaths?: string[];

  /** The user confirms they are allowed to test this site. Required. */
  @IsBoolean()
  authorized!: boolean;

  /** Off by default. When false, destructive-looking steps are rejected. */
  @IsOptional()
  @IsBoolean()
  allowDestructive?: boolean;
}
