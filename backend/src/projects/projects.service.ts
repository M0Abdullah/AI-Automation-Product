import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProjectDto } from './dto/create-project.dto';

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateProjectDto) {
    return this.prisma.project.create({
      data: { name: dto.name, baseUrl: stripTrailingSlash(dto.baseUrl) },
    });
  }

  findAll() {
    return this.prisma.project.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { runs: true } } },
    });
  }

  async findOne(id: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        runs: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: { id: true, name: true, status: true, createdAt: true, targetUrl: true },
        },
      },
    });
    if (!project) throw new NotFoundException(`Project ${id} not found`);
    return project;
  }

  /**
   * Used by the "just give me a URL" flow: the frontend does not have to create
   * a project first, so we reuse one per origin.
   */
  async findOrCreateForUrl(url: string, suggestedName?: string) {
    const origin = new URL(url).origin;
    const existing = await this.prisma.project.findFirst({ where: { baseUrl: origin } });
    if (existing) return existing;
    return this.prisma.project.create({
      data: { name: suggestedName?.trim() || new URL(url).hostname, baseUrl: origin },
    });
  }
}

function stripTrailingSlash(u: string) {
  return u.endsWith('/') ? u.slice(0, -1) : u;
}
